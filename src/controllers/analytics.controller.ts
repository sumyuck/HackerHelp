import { Request, Response } from 'express';
import { User, Team, Track, Registration, Submission, JudgeEvaluation } from '../database/models';
import { logger } from '../logger';

export async function getAnalyticsMetrics(req: Request, res: Response): Promise<void> {
  try {
    const totalUsers = await User.countDocuments();
    const totalRegistrations = await Registration.countDocuments();
    const totalTeams = await Team.countDocuments();
    const totalTracks = await Track.countDocuments();
    const totalSubmissions = await Submission.countDocuments();

    // 1. Completion Percentage (Teams that submitted / Total Teams)
    let completionPercentage = 0;
    if (totalTeams > 0) {
      completionPercentage = parseFloat(((totalSubmissions / totalTeams) * 100).toFixed(2));
    }

    // 2. Popular Tech Stacks (Aggregate from submissions)
    const submissions = await Submission.find({}, 'techStack');
    const techStackCounts: Record<string, number> = {};
    submissions.forEach(sub => {
      if (Array.isArray(sub.techStack)) {
        sub.techStack.forEach(tech => {
          const cleanTech = tech.trim().toLowerCase();
          if (cleanTech) {
            techStackCounts[cleanTech] = (techStackCounts[cleanTech] || 0) + 1;
          }
        });
      }
    });
    
    // Sort tech stacks by popularity
    const popularTechStacks = Object.entries(techStackCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // 3. Track Registrations distribution
    const teams = await Team.find({}, 'trackId');
    const trackTeamsCount: Record<string, number> = {};
    for (const team of teams) {
      if (team.trackId) {
        const trackStr = team.trackId.toString();
        trackTeamsCount[trackStr] = (trackTeamsCount[trackStr] || 0) + 1;
      }
    }

    const tracks = await Track.find({}, 'title');
    const trackDistribution = tracks.map(t => ({
      trackId: t._id,
      title: t.title,
      teamCount: trackTeamsCount[t._id.toString()] || 0
    }));

    // 4. Judging Progress
    // Total evaluations made
    const totalEvaluations = await JudgeEvaluation.countDocuments();
    // Unique submissions evaluated
    const uniqueEvaluatedSubmissions = await JudgeEvaluation.distinct('submissionId');
    const evaluatedSubmissionsCount = uniqueEvaluatedSubmissions.length;
    let judgingProgressPercentage = 0;
    if (totalSubmissions > 0) {
      judgingProgressPercentage = parseFloat(((evaluatedSubmissionsCount / totalSubmissions) * 100).toFixed(2));
    }

    // 5. Basic role distribution
    const judgesCount = await User.countDocuments({ roles: 'judge' });
    const mentorsCount = await User.countDocuments({ roles: 'mentor' });
    const participantsCount = await User.countDocuments({ roles: 'participant' });

    res.status(200).json({
      success: true,
      data: {
        summary: {
          users: totalUsers,
          registrations: totalRegistrations,
          teams: totalTeams,
          tracks: totalTracks,
          submissions: totalSubmissions,
          completionPercentage,
          judgingProgressPercentage
        },
        roles: {
          judges: judgesCount,
          mentors: mentorsCount,
          participants: participantsCount
        },
        popularTechStacks,
        trackDistribution,
        evaluationsCount: totalEvaluations
      }
    });
  } catch (error: any) {
    logger.error('Failed to aggregate analytics metrics:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while compiling analytics data.'
    });
  }
}
