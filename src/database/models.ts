import { Schema, model, Document, Types } from 'mongoose';

// --- USER MODEL ---
export type GlobalRole = 'super_admin' | 'event_admin' | 'track_admin' | 'judge' | 'mentor' | 'participant';

export interface IUser {
  discordId: string;
  username: string;
  email?: string;
  roles: GlobalRole[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserDocument extends IUser, Document {}

const UserSchema = new Schema<IUserDocument>({
  discordId: { type: String, required: true, unique: true },
  username: { type: String, required: true },
  email: { type: String },
  roles: [{ type: String, enum: ['super_admin', 'event_admin', 'track_admin', 'judge', 'mentor', 'participant'], default: ['participant'] }]
}, { timestamps: true });


// --- HACKATHON MODEL ---
export type HackathonStatus = 
  | 'Upcoming'
  | 'Registration Open'
  | 'Registration Closed'
  | 'Submission Open'
  | 'Submission Closed'
  | 'Judging'
  | 'Completed'
  | 'Archived';

export interface IHackathon {
  name: string;
  description?: string;
  logoUrl?: string;
  startDate: Date;
  endDate: Date;
  registrationStart: Date;
  registrationEnd: Date;
  submissionStart: Date;
  submissionEnd: Date;
  judgingStart: Date;
  judgingEnd: Date;
  resultDate: Date;
  discordServerId: string;
  organizers: string[]; // Array of Discord User IDs
  status: HackathonStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface IHackathonDocument extends IHackathon, Document {}

const HackathonSchema = new Schema<IHackathonDocument>({
  name: { type: String, required: true },
  description: { type: String },
  logoUrl: { type: String },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  registrationStart: { type: Date, required: true },
  registrationEnd: { type: Date, required: true },
  submissionStart: { type: Date, required: true },
  submissionEnd: { type: Date, required: true },
  judgingStart: { type: Date, required: true },
  judgingEnd: { type: Date, required: true },
  resultDate: { type: Date, required: true },
  discordServerId: { type: String, required: true },
  organizers: [{ type: String }],
  status: { 
    type: String, 
    enum: ['Upcoming', 'Registration Open', 'Registration Closed', 'Submission Open', 'Submission Closed', 'Judging', 'Completed', 'Archived'], 
    default: 'Upcoming' 
  }
}, { timestamps: true });


// --- TRACK MODEL ---
export interface ITrack {
  hackathonId: Types.ObjectId;
  title: string;
  description?: string;
  judges: string[]; // Array of Discord User IDs
  mentors: string[]; // Array of Discord User IDs
  admins: string[]; // Array of Discord User IDs (Track Admins)
  maxTeams?: number;
  deadline?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITrackDocument extends ITrack, Document {}

const TrackSchema = new Schema<ITrackDocument>({
  hackathonId: { type: Schema.Types.ObjectId, ref: 'Hackathon', required: true },
  title: { type: String, required: true },
  description: { type: String },
  judges: [{ type: String }],
  mentors: [{ type: String }],
  admins: [{ type: String }],
  maxTeams: { type: Number },
  deadline: { type: Date }
}, { timestamps: true });


// --- TEAM MODEL ---
export interface ITeamInvitation {
  userId: string; // Discord ID
  status: 'pending' | 'accepted' | 'rejected';
}

export interface ITeam {
  name: string;
  hackathonId: Types.ObjectId;
  trackId: Types.ObjectId;
  leaderId: string; // Discord User ID
  members: string[]; // Array of Discord User IDs
  invitations: ITeamInvitation[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ITeamDocument extends ITeam, Document {}

const TeamSchema = new Schema<ITeamDocument>({
  name: { type: String, required: true },
  hackathonId: { type: Schema.Types.ObjectId, ref: 'Hackathon', required: true },
  trackId: { type: Schema.Types.ObjectId, ref: 'Track', required: true },
  leaderId: { type: String, required: true },
  members: [{ type: String, required: true }],
  invitations: [{
    userId: { type: String, required: true },
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' }
  }]
}, { timestamps: true });


// --- REGISTRATION MODEL ---
export interface IRegistration {
  userId: string; // Discord User ID
  hackathonId: Types.ObjectId;
  fullName: string;
  college: string;
  email: string;
  github: string;
  linkedin: string;
  skills: string[];
  experience: string;
  preferredTrackId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface IRegistrationDocument extends IRegistration, Document {}

const RegistrationSchema = new Schema<IRegistrationDocument>({
  userId: { type: String, required: true },
  hackathonId: { type: Schema.Types.ObjectId, ref: 'Hackathon', required: true },
  fullName: { type: String, required: true },
  college: { type: String, required: true },
  email: { type: String, required: true },
  github: { type: String, required: true },
  linkedin: { type: String, required: true },
  skills: [{ type: String }],
  experience: { type: String, required: true },
  preferredTrackId: { type: Schema.Types.ObjectId, ref: 'Track' }
}, { timestamps: true });


// --- SUBMISSION MODEL ---
export interface ISubmission {
  teamId: Types.ObjectId;
  hackathonId: Types.ObjectId;
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
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISubmissionDocument extends ISubmission, Document {}

const SubmissionSchema = new Schema<ISubmissionDocument>({
  teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true, unique: true },
  hackathonId: { type: Schema.Types.ObjectId, ref: 'Hackathon', required: true },
  projectName: { type: String, required: true },
  problemStatement: { type: String, required: true },
  solution: { type: String, required: true },
  techStack: [{ type: String }],
  architectureDescription: { type: String },
  innovationPoints: { type: String },
  githubLink: { type: String, required: true },
  demoLink: { type: String },
  presentationLink: { type: String },
  additionalNotes: { type: String },
  currentVersion: { type: Number, default: 1 }
}, { timestamps: true });


// --- SUBMISSION VERSION MODEL ---
export interface ISubmissionVersion {
  submissionId: Types.ObjectId;
  version: number;
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
  createdById: string; // Discord ID
  createdAt: Date;
}

export interface ISubmissionVersionDocument extends ISubmissionVersion, Document {}

const SubmissionVersionSchema = new Schema<ISubmissionVersionDocument>({
  submissionId: { type: Schema.Types.ObjectId, ref: 'Submission', required: true },
  version: { type: Number, required: true },
  projectName: { type: String, required: true },
  problemStatement: { type: String, required: true },
  solution: { type: String, required: true },
  techStack: [{ type: String }],
  architectureDescription: { type: String },
  innovationPoints: { type: String },
  githubLink: { type: String, required: true },
  demoLink: { type: String },
  presentationLink: { type: String },
  additionalNotes: { type: String },
  createdById: { type: String, required: true }
}, { timestamps: true });


// --- JUDGE EVALUATION MODEL ---
export interface IRubricScores {
  innovation: number; // 1-10
  technicalComplexity: number; // 1-10
  implementation: number; // 1-10
  scalability: number; // 1-10
  presentation: number; // 1-10
  businessValue: number; // 1-10
  ux: number; // 1-10
  impact: number; // 1-10
}

export interface IJudgeEvaluation {
  submissionId: Types.ObjectId;
  judgeId: string; // Discord ID
  scores: IRubricScores;
  weightedScore: number;
  comment?: string;
  shortlisted: boolean;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: Date;
  updatedAt: Date;
}

export interface IJudgeEvaluationDocument extends IJudgeEvaluation, Document {}

const JudgeEvaluationSchema = new Schema<IJudgeEvaluationDocument>({
  submissionId: { type: Schema.Types.ObjectId, ref: 'Submission', required: true },
  judgeId: { type: String, required: true },
  scores: {
    innovation: { type: Number, required: true, min: 1, max: 10 },
    technicalComplexity: { type: Number, required: true, min: 1, max: 10 },
    implementation: { type: Number, required: true, min: 1, max: 10 },
    scalability: { type: Number, required: true, min: 1, max: 10 },
    presentation: { type: Number, required: true, min: 1, max: 10 },
    businessValue: { type: Number, required: true, min: 1, max: 10 },
    ux: { type: Number, required: true, min: 1, max: 10 },
    impact: { type: Number, required: true, min: 1, max: 10 }
  },
  weightedScore: { type: Number, required: true },
  comment: { type: String },
  shortlisted: { type: Boolean, default: false },
  status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' }
}, { timestamps: true });


// --- ANNOUNCEMENT MODEL ---
export interface IAnnouncement {
  hackathonId: Types.ObjectId;
  title: string;
  originalContent: string;
  proVersion?: string;
  discordVersion?: string;
  shortVersion?: string;
  sentAt?: Date;
  sentBy: string; // Discord ID
  createdAt: Date;
  updatedAt: Date;
}

export interface IAnnouncementDocument extends IAnnouncement, Document {}

const AnnouncementSchema = new Schema<IAnnouncementDocument>({
  hackathonId: { type: Schema.Types.ObjectId, ref: 'Hackathon', required: true },
  title: { type: String, required: true },
  originalContent: { type: String, required: true },
  proVersion: { type: String },
  discordVersion: { type: String },
  shortVersion: { type: String },
  sentAt: { type: Date },
  sentBy: { type: String, required: true }
}, { timestamps: true });


// --- AUDIT LOG MODEL ---
export interface IAuditLog {
  actorId: string; // Discord ID
  action: string;
  targetType?: string;
  targetId?: string;
  details?: any;
  createdAt: Date;
}

export interface IAuditLogDocument extends IAuditLog, Document {}

const AuditLogSchema = new Schema<IAuditLogDocument>({
  actorId: { type: String, required: true },
  action: { type: String, required: true },
  targetType: { type: String },
  targetId: { type: String },
  details: { type: Schema.Types.Mixed }
}, { timestamps: true });


// --- SETTINGS MODEL ---
export interface ISetting {
  key: string;
  value: any;
}

export interface ISettingDocument extends ISetting, Document {}

const SettingSchema = new Schema<ISettingDocument>({
  key: { type: String, required: true, unique: true },
  value: { type: Schema.Types.Mixed }
});


// --- EXPORTS ---
export const User = model<IUserDocument>('User', UserSchema);
export const Hackathon = model<IHackathonDocument>('Hackathon', HackathonSchema);
export const Track = model<ITrackDocument>('Track', TrackSchema);
export const Team = model<ITeamDocument>('Team', TeamSchema);
export const Registration = model<IRegistrationDocument>('Registration', RegistrationSchema);
export const Submission = model<ISubmissionDocument>('Submission', SubmissionSchema);
export const SubmissionVersion = model<ISubmissionVersionDocument>('SubmissionVersion', SubmissionVersionSchema);
export const JudgeEvaluation = model<IJudgeEvaluationDocument>('JudgeEvaluation', JudgeEvaluationSchema);
export const Announcement = model<IAnnouncementDocument>('Announcement', AnnouncementSchema);
export const AuditLog = model<IAuditLogDocument>('AuditLog', AuditLogSchema);
export const Setting = model<ISettingDocument>('Setting', SettingSchema);
