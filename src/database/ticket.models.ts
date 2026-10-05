import { Schema, model, Document } from 'mongoose';
import type { TicketStatus } from '../tickets/ticket-state';
import type { Priority } from '../services/triage-rules';

export const TICKET_CATEGORIES = [
  'event_info', 'rewards', 'submission', 'interview', 'evaluation', 'technical', 'account', 'conduct', 'general'
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];
export const PRIORITIES: Priority[] = ['low', 'normal', 'high', 'urgent'];

// --- TICKET ---
export interface ITicketHistoryEntry {
  at: Date;
  actorId: string;
  action: string;
  from?: TicketStatus;
  to?: TicketStatus;
  note?: string;
}

export interface ITicket {
  number: number;
  guildId: string;
  creatorId: string;
  creatorTag: string;
  question: string;
  title: string;
  summary: string;
  /** Normalised "<component>: <problem>" statement used for duplicate detection. */
  canonicalIssue: string;
  category: TicketCategory;
  priority: Priority;
  status: TicketStatus;
  assigneeId: string | null;
  threadId: string | null;
  /** Why the bot handed off, e.g. "deterministic_gate:prize_payment" or "user_requested". */
  escalationReason: string;
  /** Knowledge-base sections the bot retrieved, so moderators see what it already knew. */
  context: { slug: string | null; title: string; similarity: number }[];
  relatedTicketNumbers: number[];
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  firstModeratorActionAt: Date | null;
  addedToKnowledgeBase: boolean;
  /** Idempotency key (the originating Discord interaction ID). Retries and double clicks reuse the ticket. */
  sourceKey: string;
  history: ITicketHistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ITicketDocument extends ITicket, Document {}

const TicketSchema = new Schema<ITicketDocument>({
  number: { type: Number, required: true },
  guildId: { type: String, required: true },
  creatorId: { type: String, required: true },
  creatorTag: { type: String, required: true },
  question: { type: String, required: true },
  title: { type: String, required: true },
  summary: { type: String, required: true },
  canonicalIssue: { type: String, required: true },
  category: { type: String, enum: TICKET_CATEGORIES, required: true },
  priority: { type: String, enum: PRIORITIES, required: true },
  status: { type: String, enum: ['open', 'assigned', 'waiting_user', 'resolved'], default: 'open' },
  assigneeId: { type: String, default: null },
  threadId: { type: String, default: null },
  escalationReason: { type: String, required: true },
  context: [{ _id: false, slug: String, title: String, similarity: Number }],
  relatedTicketNumbers: [Number],
  resolution: { type: String, default: null },
  resolvedBy: { type: String, default: null },
  resolvedAt: { type: Date, default: null },
  firstModeratorActionAt: { type: Date, default: null },
  addedToKnowledgeBase: { type: Boolean, default: false },
  sourceKey: { type: String, required: true, unique: true },
  history: [{
    _id: false,
    at: { type: Date, required: true },
    actorId: { type: String, required: true },
    action: { type: String, required: true },
    from: String,
    to: String,
    note: String
  }]
}, { timestamps: true });

TicketSchema.index({ guildId: 1, number: 1 }, { unique: true });
TicketSchema.index({ threadId: 1 }, { sparse: true });
TicketSchema.index({ creatorId: 1, status: 1 });

// --- COUNTER (atomic per-guild ticket numbers) ---
const CounterSchema = new Schema<{ _id: string; seq: number }>({ _id: String, seq: { type: Number, default: 0 } });

// --- PENDING TICKET REQUEST ---
// Context for "Open a ticket" buttons attached to /ask replies. Button custom IDs
// are limited to 100 characters, so the question and triage result live here.
export interface IPendingTicketRequest {
  _id: string; // originating interaction ID
  guildId: string;
  userId: string;
  userTag: string;
  question: string;
  escalationReason: string;
  sensitiveCategory: string | null;
  priority: Priority | null;
  context: { slug: string | null; title: string; similarity: number }[];
  createdAt: Date;
}

const PendingTicketRequestSchema = new Schema<IPendingTicketRequest>({
  _id: String,
  guildId: { type: String, required: true },
  userId: { type: String, required: true },
  userTag: { type: String, required: true },
  question: { type: String, required: true },
  escalationReason: { type: String, required: true },
  sensitiveCategory: { type: String, default: null },
  priority: { type: String, default: null },
  context: [{ _id: false, slug: String, title: String, similarity: Number }],
  // Buttons older than a day are stale; MongoDB's TTL monitor removes them.
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 }
});

// --- SUPPORT EVENT (append-only facts for analytics) ---
export type SupportEventType =
  | 'question_answered'
  | 'question_clarified'
  | 'question_escalated'
  | 'question_out_of_scope'
  | 'question_refused'
  | 'question_error'
  | 'answer_marked_helpful'
  | 'duplicate_prevented'
  | 'resolution_reused'
  | 'ticket_created'
  | 'ticket_transition';

export interface ISupportEvent {
  guildId: string;
  type: SupportEventType;
  userId: string;
  ticketNumber?: number;
  category?: string;
  reason?: string;
  details?: Record<string, unknown>;
  /** Set when the same fact could be recorded twice (job retries, double clicks); unique per guild. */
  dedupeKey?: string;
  createdAt: Date;
}

const SupportEventSchema = new Schema<ISupportEvent>({
  guildId: { type: String, required: true },
  type: { type: String, required: true },
  userId: { type: String, required: true },
  ticketNumber: Number,
  category: String,
  reason: String,
  details: Schema.Types.Mixed,
  dedupeKey: String,
  createdAt: { type: Date, default: Date.now }
});
SupportEventSchema.index({ guildId: 1, type: 1, createdAt: -1 });
SupportEventSchema.index({ guildId: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });

export const Ticket = model<ITicketDocument>('Ticket', TicketSchema);
export const Counter = model('Counter', CounterSchema);
export const PendingTicketRequest = model<IPendingTicketRequest>('PendingTicketRequest', PendingTicketRequestSchema);
export const SupportEvent = model<ISupportEvent>('SupportEvent', SupportEventSchema);
