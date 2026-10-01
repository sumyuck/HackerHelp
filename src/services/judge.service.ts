import { Types } from 'mongoose';
import { JudgeEvaluation, Submission, Team, Track, IRubricScores } from '../database/models';
import { logAction } from './user.service';
import { askDocMindRAG } from './docmind.service';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console()
  ]
});


/**
 * Submits score and feedback for a project.
 * Calculates weighted score from the 8 rubrics.
 */
export async function scoreSubmission(
  judgeDiscordId: string,
  submissionId: string,
  scores: IRubricScores,
  comment?: string
): Promise<any> {
  const sId = new Types.ObjectId(submissionId);
  const submission = await Submission.findById(sId);
  if (!submission) {
    throw new Error('Submission not found.');
  }

  // Calculate weighted score (average of all 8 criteria)
  const sum = 
    scores.innovation +
    scores.technicalComplexity +
    scores.implementation +
    scores.scalability +
    scores.presentation +
    scores.businessValue +
    scores.ux +
    scores.impact;
  const weightedScore = parseFloat((sum / 8).toFixed(2));

  let evaluation = await JudgeEvaluation.findOne({ submissionId: sId, judgeId: judgeDiscordId });
  if (evaluation) {
    evaluation.scores = scores;
    evaluation.weightedScore = weightedScore;
    evaluation.comment = comment;
    await evaluation.save();
  } else {
    evaluation = await JudgeEvaluation.create({
      submissionId: sId,
      judgeId: judgeDiscordId,
      scores,
      weightedScore,
      comment,
      shortlisted: false,
      status: 'pending'
    });
  }

  await logAction(judgeDiscordId, 'score_submission', 'JudgeEvaluation', evaluation.id.toString(), { weightedScore });
  return evaluation;
}

/**
 * Summarizes the project submission using AI.
 * Queries the DocMind RAG to generate a grounded, structured evaluation.
 */
export async function generateProjectSummary(
  actorId: string,
  submissionId: string
): Promise<string> {
  const submission = await Submission.findById(new Types.ObjectId(submissionId)).populate('teamId');
  if (!submission) {
    throw new Error('Submission not found.');
  }

  const team = submission.teamId as any;

  // Compile project details as context
  const contextText = `
Project Name: ${submission.projectName}
Problem Statement: ${submission.problemStatement}
Solution: ${submission.solution}
Tech Stack: ${submission.techStack.join(', ')}
Architecture: ${submission.architectureDescription || 'Not specified'}
Innovation: ${submission.innovationPoints || 'Not specified'}
GitHub: ${submission.githubLink}
Demo: ${submission.demoLink || 'Not specified'}
Presentation: ${submission.presentationLink || 'Not specified'}
Notes: ${submission.additionalNotes || 'None'}
  `;

  const prompt = `
Generate an objective, detailed evaluation report for the following hackathon project submission:

${contextText}

Structure the report with:
1. **Executive Summary**: A concise 3-sentence overview.
2. **Key Innovations & Strengths**: Bullet points of what stands out.
3. **Technical Complexity & Feasibility**: Evaluate their chosen tech stack and architecture.
4. **Constructive Feedback & Suggestions**: Areas for growth or improvements.
  `;

  logger.info(`Requesting AI summary for project: ${submission.projectName}`);

  // Send the context to the DocMind chat function as a user query
  const response = await askDocMindRAG([
    {
      role: 'system',
      content: 'You are an expert technical hackathon judge evaluator. Provide professional, detailed, and objective project feedback.'
    },
    {
      role: 'user',
      content: prompt
    }
  ]);

  await logAction(actorId, 'generate_project_ai_summary', 'Submission', submissionId);
  return response;
}

/**
 * Gets a list of submissions assigned to a judge based on the tracks they judge.
 */
export async function getAssignedSubmissions(judgeDiscordId: string): Promise<any[]> {
  // Find tracks where this user is assigned as a judge
  const tracks = await Track.find({ judges: judgeDiscordId });
  const trackIds = tracks.map(t => t._id);

  if (trackIds.length === 0) {
    return [];
  }

  // Find teams assigned to these tracks
  const teams = await Team.find({ trackId: { $in: trackIds } });
  const teamIds = teams.map(t => t._id);

  // Find submissions for these teams
  return Submission.find({ teamId: { $in: teamIds } }).populate('teamId');
}

/**
 * Generates an evaluation report compiling all scores and comments for a submission.
 */
export async function getSubmissionEvaluationReport(submissionId: string): Promise<any> {
  const submission = await Submission.findById(new Types.ObjectId(submissionId)).populate('teamId');
  if (!submission) {
    throw new Error('Submission not found.');
  }

  const evaluations = await JudgeEvaluation.find({ submissionId: submission._id });
  
  const totalEvaluations = evaluations.length;
  if (totalEvaluations === 0) {
    return {
      submission,
      evaluations: [],
      averageScore: 0
    };
  }

  const sumScores = evaluations.reduce((acc, curr) => acc + curr.weightedScore, 0);
  const averageScore = parseFloat((sumScores / totalEvaluations).toFixed(2));

  return {
    submission,
    evaluations,
    averageScore
  };
}
