import { logger } from '../logger';
import {
  Counter, ITicketDocument, PendingTicketRequest, SupportEvent, SupportEventType, Ticket, TicketCategory
} from '../database/ticket.models';
import { decideDuplicate } from '../tickets/dedup-policy';
import { Actor, OPEN_STATUSES, TicketAction, transition } from '../tickets/ticket-state';
import { generateEmbedding } from './embedding.service';
import { indexDocument } from './knowledge.service';
import { classifyTicket, fallbackClassification } from './ticket-classifier.service';
import { dedupThresholds, findSimilarTickets, updateTicketEmbeddingStatus, upsertTicketEmbedding } from './ticket-similarity.service';
import type { Priority, SensitiveCategory } from './triage-rules';

/**
 * Ticket workflows, independent of discord.js. Discord specifics (forum posts,
 * tags, mentions) sit behind the TicketChannel port, which keeps this module
 * unit-testable and lets a queue worker run it unchanged.
 */

export interface TicketChannel {
  /** Creates the moderator-facing thread and returns its ID. */
  createThread(ticket: ITicketDocument): Promise<string>;
  /** Reflects a lifecycle change in the thread (tags, status message, archive). */
  syncThread(ticket: ITicketDocument, event: { action: TicketAction; actorId: string; note?: string }): Promise<void>;
  threadUrl(ticket: ITicketDocument): string | null;
}

export interface OpenTicketInput {
  /** Idempotency key: the originating interaction ID. The same key always yields the same ticket. */
  sourceKey: string;
  guildId: string;
  creatorId: string;
  creatorTag: string;
  question: string;
  escalationReason: string;
  sensitiveCategory: SensitiveCategory | null;
  priority: Priority | null;
  context: { slug: string | null; title: string; similarity: number }[];
  /** Skip the "a similar issue was resolved" suggestion (the user already declined it). */
  forceCreate?: boolean;
}

export type OpenTicketResult =
  | { kind: 'created'; ticket: ITicketDocument }
  | { kind: 'existing'; ticket: ITicketDocument; why: 'replay' | 'own_duplicate' }
  | { kind: 'suggest_resolution'; ticket: ITicketDocument; similarity: number };

export async function recordEvent(event: {
  guildId: string; type: SupportEventType; userId: string; ticketNumber?: number;
  category?: string; reason?: string; details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await SupportEvent.create(event);
  } catch (error) {
    // Analytics must never break the support flow.
    logger.error('Failed to record support event', { type: event.type, error });
  }
}

async function nextTicketNumber(guildId: string): Promise<number> {
  // Atomic increment: concurrent creations can never receive the same number.
  const counter = await Counter.findOneAndUpdate(
    { _id: `ticket:${guildId}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return counter!.seq;
}

async function ensureThread(ticket: ITicketDocument, channel: TicketChannel): Promise<ITicketDocument> {
  if (ticket.threadId) return ticket;
  // Claim-then-act: the ticket row exists before the thread does. If the process died
  // between the two, a retry with the same sourceKey lands here and finishes the job.
  ticket.threadId = await channel.createThread(ticket);
  await Ticket.updateOne({ _id: ticket._id, threadId: null }, { $set: { threadId: ticket.threadId } });
  return ticket;
}

const isDuplicateKeyError = (error: any) => error?.code === 11000;

export async function openTicket(input: OpenTicketInput, channel: TicketChannel): Promise<OpenTicketResult> {
  const replay = await Ticket.findOne({ sourceKey: input.sourceKey });
  if (replay) return { kind: 'existing', ticket: await ensureThread(replay, channel), why: 'replay' };

  // Classify first: duplicate detection compares canonical issue statements ("Prize: payment not
  // received"), not raw messages. On raw text no threshold separated real duplicates from
  // look-alikes; see eval/RESULTS.md (ticket duplicate detection).
  const gate = { category: input.sensitiveCategory, priority: input.priority };
  let classification;
  try {
    classification = await classifyTicket(input.question, gate);
  } catch (error: any) {
    logger.warn('Ticket classifier unavailable; using fallback classification', { detail: error?.message });
    classification = fallbackClassification(input.question, gate);
  }

  // Duplicate detection degrades open: if embeddings or vector search are down, still create the ticket.
  let embedding: number[] | null = null;
  let candidates: Awaited<ReturnType<typeof findSimilarTickets>> = [];
  const thresholds = dedupThresholds();
  try {
    embedding = await generateEmbedding(classification.canonicalIssue);
    candidates = await findSimilarTickets(input.guildId, embedding, thresholds.related);
  } catch (error: any) {
    logger.warn('Duplicate detection unavailable; creating ticket without it', { detail: error?.message });
  }

  const decision = decideDuplicate(input.creatorId, candidates, thresholds, { forceCreate: input.forceCreate });
  if (decision.action === 'existing_own_ticket') {
    const existing = await Ticket.findById(decision.match.ticketId);
    if (existing && OPEN_STATUSES.includes(existing.status)) {
      await recordEvent({ guildId: input.guildId, type: 'duplicate_prevented', userId: input.creatorId, ticketNumber: existing.number, details: { similarity: decision.match.similarity } });
      return { kind: 'existing', ticket: await ensureThread(existing, channel), why: 'own_duplicate' };
    }
  }
  if (decision.action === 'suggest_resolution') {
    const resolved = await Ticket.findById(decision.match.ticketId);
    if (resolved?.resolution) return { kind: 'suggest_resolution', ticket: resolved, similarity: decision.match.similarity };
  }

  const related = decision.action === 'existing_own_ticket' ? [] : decision.related;
  let ticket: ITicketDocument;
  try {
    ticket = await Ticket.create({
      number: await nextTicketNumber(input.guildId),
      guildId: input.guildId,
      creatorId: input.creatorId,
      creatorTag: input.creatorTag,
      question: input.question,
      title: classification.title,
      summary: classification.summary,
      canonicalIssue: classification.canonicalIssue,
      category: classification.category,
      priority: classification.priority,
      escalationReason: input.escalationReason,
      context: input.context,
      relatedTicketNumbers: related.map(t => t.ticketNumber),
      sourceKey: input.sourceKey,
      history: [{ at: new Date(), actorId: input.creatorId, action: 'created', to: 'open', note: classification.reason }]
    });
  } catch (error) {
    // Two deliveries of the same interaction raced past the replay check: the unique index picks one winner.
    if (!isDuplicateKeyError(error)) throw error;
    const winner = await Ticket.findOne({ sourceKey: input.sourceKey });
    if (!winner) throw error;
    return { kind: 'existing', ticket: await ensureThread(winner, channel), why: 'replay' };
  }

  ticket = await ensureThread(ticket, channel);

  if (embedding) {
    await upsertTicketEmbedding(
      { id: String(ticket._id), guildId: ticket.guildId, number: ticket.number, creatorId: ticket.creatorId, status: ticket.status },
      embedding
    ).catch(error => logger.error('Failed to index ticket for duplicate detection', { ticket: ticket.number, error }));
  }
  await recordEvent({
    guildId: ticket.guildId, type: 'ticket_created', userId: ticket.creatorId, ticketNumber: ticket.number,
    category: ticket.category, reason: ticket.escalationReason, details: { priority: ticket.priority, related: ticket.relatedTicketNumbers }
  });
  logger.info('Ticket created', { number: ticket.number, category: ticket.category, priority: ticket.priority, reason: ticket.escalationReason });
  return { kind: 'created', ticket };
}

export type TicketActionResult = { ok: true; ticket: ITicketDocument } | { ok: false; error: string };

export async function applyTicketAction(
  ticket: ITicketDocument,
  action: TicketAction,
  actor: Actor,
  channel: TicketChannel,
  options: { assigneeId?: string; note?: string; resolution?: string; addToKnowledgeBase?: boolean } = {}
): Promise<TicketActionResult> {
  const result = transition(ticket, action, actor, { assigneeId: options.assigneeId });
  if (!result.ok) return result;
  if (action === 'resolve' && !options.resolution?.trim()) return { ok: false, error: 'A resolution is required.' };

  const set: Record<string, unknown> = { status: result.status, assigneeId: result.assigneeId };
  if (actor.isModerator && !ticket.firstModeratorActionAt) set.firstModeratorActionAt = new Date();
  if (action === 'resolve') Object.assign(set, { resolution: options.resolution!.trim(), resolvedBy: actor.id, resolvedAt: new Date() });
  if (action === 'reopen') Object.assign(set, { resolvedAt: null });

  // Optimistic concurrency: the update only applies if nobody changed the status in between,
  // so two moderators resolving at once cannot both "win".
  const updated = await Ticket.findOneAndUpdate(
    { _id: ticket._id, status: ticket.status },
    {
      $set: set,
      $push: { history: { at: new Date(), actorId: actor.id, action, from: ticket.status, to: result.status, note: options.note ?? options.resolution } }
    },
    { new: true }
  );
  if (!updated) return { ok: false, error: 'This ticket was just changed by someone else. Check its status and try again.' };

  if (action === 'resolve' && options.addToKnowledgeBase) {
    await addResolutionToKnowledgeBase(updated, channel).catch(error =>
      logger.error('Failed to add resolution to knowledge base', { ticket: updated.number, error }));
  }

  await updateTicketEmbeddingStatus(String(updated._id), updated.status).catch(error =>
    logger.error('Failed to update ticket status for duplicate detection', { ticket: updated.number, error }));
  await channel.syncThread(updated, { action, actorId: actor.id, note: options.note ?? options.resolution }).catch(error =>
    logger.error('Failed to sync ticket thread', { ticket: updated.number, error }));
  await recordEvent({
    guildId: updated.guildId, type: 'ticket_transition', userId: actor.id, ticketNumber: updated.number,
    category: updated.category, details: { action, from: ticket.status, to: updated.status }
  });
  return { ok: true, ticket: updated };
}

/**
 * A moderator's resolution becomes retrievable knowledge, so the next person
 * with the same question gets an answer instead of a ticket. The neutral summary
 * is used rather than the raw question, which may contain personal details.
 */
async function addResolutionToKnowledgeBase(ticket: ITicketDocument, channel: TicketChannel): Promise<void> {
  await indexDocument({
    slug: `tickets/${ticket.guildId}/${ticket.number}`,
    title: `Resolved support question: ${ticket.title}`,
    body: `## Question\n${ticket.summary}\n\n## Answer from the moderators\n${ticket.resolution}`,
    sourceUrl: channel.threadUrl(ticket),
    origin: 'ticket_resolution',
    verification: 'official'
  });
  await Ticket.updateOne({ _id: ticket._id }, { $set: { addedToKnowledgeBase: true } });
  ticket.addedToKnowledgeBase = true;
}

export async function findTicket(guildId: string, ref: { number?: number | null; threadId?: string | null }): Promise<ITicketDocument | null> {
  if (ref.number) return Ticket.findOne({ guildId, number: ref.number });
  if (ref.threadId) return Ticket.findOne({ guildId, threadId: ref.threadId });
  return null;
}

export async function listOpenTicketsFor(guildId: string, creatorId: string): Promise<ITicketDocument[]> {
  return Ticket.find({ guildId, creatorId, status: { $in: OPEN_STATUSES } }).sort({ number: -1 }).limit(10);
}

export async function savePendingRequest(request: {
  id: string; guildId: string; userId: string; userTag: string; question: string; escalationReason: string;
  sensitiveCategory: SensitiveCategory | null; priority: Priority | null;
  context: { slug: string | null; title: string; similarity: number }[];
}): Promise<void> {
  await PendingTicketRequest.updateOne(
    { _id: request.id },
    { $setOnInsert: { ...request, _id: request.id, createdAt: new Date() } },
    { upsert: true }
  );
}

export async function getPendingRequest(id: string) {
  return PendingTicketRequest.findById(id);
}

export const CATEGORY_LABELS: Record<TicketCategory, string> = {
  event_info: 'Event info', rewards: 'Rewards', submission: 'Submission', interview: 'Interview',
  evaluation: 'Evaluation', technical: 'Technical', account: 'Account', conduct: 'Conduct', general: 'General'
};
