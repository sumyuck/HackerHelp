import { Types } from 'mongoose';
import { UserFacingError } from '../errors';
import { Hackathon, Track, Registration, IHackathon, ITrack, HackathonStatus } from '../database/models';
import { logAction } from './user.service';

/**
 * Creates a new hackathon.
 */
export async function createHackathon(
  actorId: string,
  data: Partial<IHackathon>
): Promise<any> {
  const hackathon = await Hackathon.create({
    ...data,
    status: data.status || 'Upcoming'
  });
  await logAction(actorId, 'create_hackathon', 'Hackathon', hackathon.id.toString(), { name: hackathon.name });
  return hackathon;
}

/**
 * Deletes a hackathon and its tracks.
 */
export async function deleteHackathon(
  actorId: string,
  hackathonId: string
): Promise<void> {
  const hId = new Types.ObjectId(hackathonId);
  const hackathon = await Hackathon.findById(hId);
  if (!hackathon) {
    throw new UserFacingError('Hackathon not found.');
  }

  await Track.deleteMany({ hackathonId: hId });
  await Hackathon.findByIdAndDelete(hId);
  await logAction(actorId, 'delete_hackathon', 'Hackathon', hackathonId, { name: hackathon.name });
}

/**
 * Updates a hackathon's details or status.
 */
export async function updateHackathonStatus(
  actorId: string,
  hackathonId: string,
  status: HackathonStatus
): Promise<any> {
  const hackathon = await Hackathon.findById(new Types.ObjectId(hackathonId));
  if (!hackathon) {
    throw new UserFacingError('Hackathon not found.');
  }

  hackathon.status = status;
  await hackathon.save();
  await logAction(actorId, 'update_hackathon_status', 'Hackathon', hackathonId, { status });
  return hackathon;
}

/**
 * Registers a participant for a hackathon.
 */
export async function registerParticipant(
  discordId: string,
  hackathonId: string,
  details: {
    fullName: string;
    college: string;
    email: string;
    github: string;
    linkedin: string;
    skills: string[];
    experience: string;
    preferredTrackId?: string;
  }
): Promise<any> {
  const hId = new Types.ObjectId(hackathonId);
  const hackathon = await Hackathon.findById(hId);
  if (!hackathon) {
    throw new UserFacingError('Hackathon not found.');
  }

  if (hackathon.status !== 'Registration Open') {
    throw new UserFacingError(`Registration is currently closed. Current status: ${hackathon.status}`);
  }

  // Check if already registered
  const existing = await Registration.findOne({ userId: discordId, hackathonId: hId });
  if (existing) {
    throw new UserFacingError('You are already registered for this hackathon!');
  }

  const registration = await Registration.create({
    userId: discordId,
    hackathonId: hId,
    fullName: details.fullName,
    college: details.college,
    email: details.email,
    github: details.github,
    linkedin: details.linkedin,
    skills: details.skills,
    experience: details.experience,
    preferredTrackId: details.preferredTrackId ? new Types.ObjectId(details.preferredTrackId) : undefined
  });

  await logAction(discordId, 'register_for_hackathon', 'Registration', registration.id.toString(), { hackathonId });
  return registration;
}

/**
 * Adds a new track to a hackathon.
 */
export async function createTrack(
  actorId: string,
  hackathonId: string,
  data: Partial<ITrack>
): Promise<any> {
  const hackathon = await Hackathon.findById(new Types.ObjectId(hackathonId));
  if (!hackathon) {
    throw new UserFacingError('Hackathon not found.');
  }

  const track = await Track.create({
    ...data,
    hackathonId: hackathon._id
  });

  await logAction(actorId, 'create_track', 'Track', track.id.toString(), { hackathonId, title: track.title });
  return track;
}

/**
 * Assigns judges or mentors to a track.
 */
export async function assignTrackStaff(
  actorId: string,
  trackId: string,
  role: 'judges' | 'mentors' | 'admins',
  staffDiscordIds: string[]
): Promise<any> {
  const track = await Track.findById(new Types.ObjectId(trackId));
  if (!track) {
    throw new UserFacingError('Track not found.');
  }

  // Add only unique IDs
  const currentSet = new Set(track[role]);
  staffDiscordIds.forEach(id => currentSet.add(id));
  track[role] = Array.from(currentSet);
  await track.save();

  await logAction(actorId, `assign_track_${role}`, 'Track', trackId, { staffDiscordIds });
  return track;
}
