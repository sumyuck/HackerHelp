import { Types } from 'mongoose';
import { UserFacingError } from '../errors';
import { Team, Hackathon, Registration } from '../database/models';
import { logAction } from './user.service';

/**
 * Creates a team. Checks that:
 * 1. Hackathon exists and registrations are open/submission is open.
 * 2. Leader is registered for the hackathon.
 * 3. Leader is not already in another team for this hackathon.
 */
export async function createTeam(
  leaderDiscordId: string,
  hackathonId: string,
  trackId: string,
  teamName: string
): Promise<any> {
  const hId = new Types.ObjectId(hackathonId);
  const tId = new Types.ObjectId(trackId);

  // Validate hackathon status
  const hackathon = await Hackathon.findById(hId);
  if (!hackathon) {
    throw new UserFacingError('Hackathon not found.');
  }

  // Ensure leader is registered
  const registration = await Registration.findOne({ userId: leaderDiscordId, hackathonId: hId });
  if (!registration) {
    throw new UserFacingError('You must register for the hackathon first before creating a team.');
  }

  // Ensure team name is unique inside the hackathon
  const existingTeamName = await Team.findOne({ hackathonId: hId, name: { $regex: new RegExp(`^${teamName}$`, 'i') } });
  if (existingTeamName) {
    throw new UserFacingError(`A team named "${teamName}" already exists for this hackathon.`);
  }

  // Check if leader is already on a team
  const existingUserTeam = await Team.findOne({ hackathonId: hId, members: leaderDiscordId });
  if (existingUserTeam) {
    throw new UserFacingError('You are already a member of a team for this hackathon!');
  }

  const team = await Team.create({
    name: teamName,
    hackathonId: hId,
    trackId: tId,
    leaderId: leaderDiscordId,
    members: [leaderDiscordId],
    invitations: []
  });

  await logAction(leaderDiscordId, 'create_team', 'Team', team.id.toString(), { hackathonId, name: teamName });
  return team;
}

/**
 * Invites a user to a team. Enforces:
 * 1. User must be registered for the hackathon.
 * 2. User cannot be in another team already.
 * 3. Max member limit (configurable, default 5).
 */
export async function inviteToTeam(
  inviterDiscordId: string,
  inviteeDiscordId: string,
  teamId: string
): Promise<void> {
  const team = await Team.findById(new Types.ObjectId(teamId));
  if (!team) {
    throw new UserFacingError('Team not found.');
  }

  if (team.leaderId !== inviterDiscordId) {
    throw new UserFacingError('Only the team leader can invite members.');
  }

  // Check if max members reached
  const maxConfig = 5; // Configurable max team size
  if (team.members.length >= maxConfig) {
    throw new UserFacingError(`Team is already full! Maximum size is ${maxConfig}.`);
  }

  // Ensure invitee is registered
  const registration = await Registration.findOne({ userId: inviteeDiscordId, hackathonId: team.hackathonId });
  if (!registration) {
    throw new UserFacingError('The invited user has not registered for this hackathon yet.');
  }

  // Ensure invitee is not in another team
  const existingUserTeam = await Team.findOne({ hackathonId: team.hackathonId, members: inviteeDiscordId });
  if (existingUserTeam) {
    throw new UserFacingError('The invited user is already on another team.');
  }

  // Check if invite is already pending
  const alreadyInvited = team.invitations.some(
    inv => inv.userId === inviteeDiscordId && inv.status === 'pending'
  );
  if (alreadyInvited) {
    throw new UserFacingError('An invitation is already pending for this user.');
  }

  // Add invitation
  team.invitations.push({
    userId: inviteeDiscordId,
    status: 'pending'
  });
  await team.save();
}

/**
 * Handles accepting/rejecting invitations.
 */
export async function handleInvitation(
  userDiscordId: string,
  teamId: string,
  accept: boolean
): Promise<void> {
  const team = await Team.findById(new Types.ObjectId(teamId));
  if (!team) {
    throw new UserFacingError('Team not found.');
  }

  const invitation = team.invitations.find(
    inv => inv.userId === userDiscordId && inv.status === 'pending'
  );
  if (!invitation) {
    throw new UserFacingError('No pending invitation found for this team.');
  }

  if (accept) {
    // Re-verify that user hasn't joined another team in the meantime
    const existingUserTeam = await Team.findOne({ hackathonId: team.hackathonId, members: userDiscordId });
    if (existingUserTeam) {
      invitation.status = 'rejected';
      await team.save();
      throw new UserFacingError('You have already joined another team. Invitation auto-rejected.');
    }

    invitation.status = 'accepted';
    team.members.push(userDiscordId);
  } else {
    invitation.status = 'rejected';
  }

  // Clean up resolved invitation
  team.invitations = team.invitations.filter(inv => inv.userId !== userDiscordId);
  await team.save();

  await logAction(userDiscordId, accept ? 'accept_invite' : 'reject_invite', 'Team', teamId);
}

/**
 * Leave team logic. Enforces leader transfer if the leader leaves.
 */
export async function leaveTeam(userDiscordId: string, teamId: string): Promise<void> {
  const team = await Team.findById(new Types.ObjectId(teamId));
  if (!team) {
    throw new UserFacingError('Team not found.');
  }

  if (!team.members.includes(userDiscordId)) {
    throw new UserFacingError('You are not a member of this team.');
  }

  if (team.leaderId === userDiscordId) {
    // If leader leaves, they must transfer ownership, or if they are the only member, delete the team
    if (team.members.length === 1) {
      await Team.findByIdAndDelete(team._id);
      await logAction(userDiscordId, 'delete_team', 'Team', teamId, { reason: 'Leader left only member team' });
      return;
    } else {
      throw new UserFacingError('You are the leader. Please transfer ownership to another member before leaving, or use `/team delete`.');
    }
  }

  team.members = team.members.filter(m => m !== userDiscordId);
  await team.save();
  await logAction(userDiscordId, 'leave_team', 'Team', teamId);
}

/**
 * Transfers team leadership to another member.
 */
export async function transferLeadership(
  leaderDiscordId: string,
  newLeaderDiscordId: string,
  teamId: string
): Promise<void> {
  const team = await Team.findById(new Types.ObjectId(teamId));
  if (!team) {
    throw new UserFacingError('Team not found.');
  }

  if (team.leaderId !== leaderDiscordId) {
    throw new UserFacingError('Only the team leader can transfer leadership.');
  }

  if (!team.members.includes(newLeaderDiscordId)) {
    throw new UserFacingError('The target user is not a member of this team.');
  }

  team.leaderId = newLeaderDiscordId;
  await team.save();
  await logAction(leaderDiscordId, 'transfer_leadership', 'Team', teamId, { newLeader: newLeaderDiscordId });
}

/**
 * Removes a member from the team. Only the leader can do this.
 */
export async function removeMember(
  leaderDiscordId: string,
  targetDiscordId: string,
  teamId: string
): Promise<void> {
  const team = await Team.findById(new Types.ObjectId(teamId));
  if (!team) {
    throw new UserFacingError('Team not found.');
  }

  if (team.leaderId !== leaderDiscordId) {
    throw new UserFacingError('Only the team leader can remove members.');
  }

  if (targetDiscordId === leaderDiscordId) {
    throw new UserFacingError('You cannot remove yourself. Use ownership transfer and leave instead.');
  }

  if (!team.members.includes(targetDiscordId)) {
    throw new UserFacingError('Member not found in the team.');
  }

  team.members = team.members.filter(m => m !== targetDiscordId);
  await team.save();
  await logAction(leaderDiscordId, 'remove_member', 'Team', teamId, { removedUser: targetDiscordId });
}

/**
 * Deletes a team. Only the leader can do this.
 */
export async function deleteTeam(leaderDiscordId: string, teamId: string): Promise<void> {
  const team = await Team.findById(new Types.ObjectId(teamId));
  if (!team) {
    throw new UserFacingError('Team not found.');
  }

  if (team.leaderId !== leaderDiscordId) {
    throw new UserFacingError('Only the team leader can delete the team.');
  }

  await Team.findByIdAndDelete(team._id);
  await logAction(leaderDiscordId, 'delete_team', 'Team', teamId, { name: team.name });
}
