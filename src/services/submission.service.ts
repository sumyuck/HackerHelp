import { Types } from 'mongoose';
import { UserFacingError } from '../errors';
import { Submission, SubmissionVersion, Team, Hackathon } from '../database/models';
import { logAction } from './user.service';

/**
 * Creates or updates a project submission.
 * Enforces:
 * 1. Submissions are open.
 * 2. User is the leader of the team.
 * 3. Team size is at least 3 members.
 * 4. Version increment and history log.
 */
export async function submitProject(
  leaderDiscordId: string,
  teamId: string,
  data: {
    projectName: string;
    problemStatement: string;
    solution: string;
    techStack: string[];
    architectureDescription?: string;
    innovationPoints?: string;
    githubLink: string;
    demoLink?: string;
    presentationLink?: string;
    additionalNotes?: string;
  }
): Promise<any> {
  const tId = new Types.ObjectId(teamId);
  const team = await Team.findById(tId);
  if (!team) {
    throw new UserFacingError('Team not found.');
  }

  if (team.leaderId !== leaderDiscordId) {
    throw new UserFacingError('Only the team leader can submit the project.');
  }

  // Enforce team size constraint (Minimum 3 members)
  if (team.members.length < 3) {
    throw new UserFacingError(`Your team has only ${team.members.length} members. Teams must have at least 3 members to submit.`);
  }

  // Validate hackathon status and timeline
  const hackathon = await Hackathon.findById(team.hackathonId);
  if (!hackathon) {
    throw new UserFacingError('Hackathon not found.');
  }

  if (hackathon.status !== 'Submission Open') {
    throw new UserFacingError(`Submissions are currently closed. Current status: ${hackathon.status}`);
  }

  const now = new Date();
  if (now < hackathon.submissionStart || now > hackathon.submissionEnd) {
    throw new UserFacingError('Submissions are closed based on the hackathon timeline.');
  }

  let submission = await Submission.findOne({ teamId: tId });
  let newVersionNumber = 1;

  if (submission) {
    newVersionNumber = submission.currentVersion + 1;
    
    // Update main submission
    submission.projectName = data.projectName;
    submission.problemStatement = data.problemStatement;
    submission.solution = data.solution;
    submission.techStack = data.techStack;
    submission.architectureDescription = data.architectureDescription;
    submission.innovationPoints = data.innovationPoints;
    submission.githubLink = data.githubLink;
    submission.demoLink = data.demoLink;
    submission.presentationLink = data.presentationLink;
    submission.additionalNotes = data.additionalNotes;
    submission.currentVersion = newVersionNumber;
    
    await submission.save();
  } else {
    // Create new submission
    submission = await Submission.create({
      teamId: tId,
      hackathonId: team.hackathonId,
      projectName: data.projectName,
      problemStatement: data.problemStatement,
      solution: data.solution,
      techStack: data.techStack,
      architectureDescription: data.architectureDescription,
      innovationPoints: data.innovationPoints,
      githubLink: data.githubLink,
      demoLink: data.demoLink,
      presentationLink: data.presentationLink,
      additionalNotes: data.additionalNotes,
      currentVersion: 1
    });
  }

  // Record version history (Never overwrite)
  await SubmissionVersion.create({
    submissionId: submission._id,
    version: newVersionNumber,
    projectName: data.projectName,
    problemStatement: data.problemStatement,
    solution: data.solution,
    techStack: data.techStack,
    architectureDescription: data.architectureDescription,
    innovationPoints: data.innovationPoints,
    githubLink: data.githubLink,
    demoLink: data.demoLink,
    presentationLink: data.presentationLink,
    additionalNotes: data.additionalNotes,
    createdById: leaderDiscordId
  });

  await logAction(
    leaderDiscordId,
    newVersionNumber === 1 ? 'create_submission' : 'update_submission',
    'Submission',
    submission.id.toString(),
    { version: newVersionNumber, projectName: data.projectName }
  );

  return submission;
}

/**
 * Gets the version history of a submission.
 */
export async function getSubmissionHistory(submissionId: string): Promise<any[]> {
  return SubmissionVersion.find({ submissionId: new Types.ObjectId(submissionId) })
    .sort({ version: -1 });
}
