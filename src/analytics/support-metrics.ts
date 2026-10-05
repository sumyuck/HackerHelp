import type { SupportEventType, TicketCategory } from '../database/ticket.models';
import type { TicketStatus } from '../tickets/ticket-state';

/**
 * Support analytics computed from recorded facts only (SupportEvent and Ticket).
 * Pure, so every definition below is unit-tested; loading lives in
 * support-analytics.service.ts.
 *
 * Definitions:
 *  - questions: every /ask, @mention and /ticket open answer attempt, by outcome.
 *  - confirmed self-serve: the user clicked "This solved it" on an answer, or
 *    "That solved it" on a past ticket's resolution. Users who leave without
 *    clicking are not counted, so this is a lower bound.
 *  - self-serve rate: confirmed self-serve / (confirmed self-serve + tickets created).
 *  - time to first moderator action / to resolution: medians over tickets created
 *    in the window that have reached that point; tickets still waiting are counted separately.
 */

export interface EventFact {
  type: SupportEventType;
}

export interface TicketFact {
  number: number;
  canonicalIssue: string;
  category: TicketCategory;
  status: TicketStatus;
  createdAt: Date;
  firstModeratorActionAt: Date | null;
  resolvedAt: Date | null;
  addedToKnowledgeBase: boolean;
}

export const QUESTION_OUTCOMES = {
  question_answered: 'answered',
  question_clarified: 'clarify',
  question_escalated: 'escalated',
  question_out_of_scope: 'out_of_scope',
  question_refused: 'refused',
  question_error: 'error'
} as const;
export type QuestionOutcome = (typeof QUESTION_OUTCOMES)[keyof typeof QUESTION_OUTCOMES];

export interface UnresolvedIssue {
  canonicalIssue: string;
  tickets: number;
  ticketNumbers: number[];
  oldestCreatedAt: Date;
}

export interface SupportMetrics {
  questions: { total: number; byOutcome: Record<QuestionOutcome, number> };
  selfServe: {
    answersMarkedHelpful: number;
    resolutionsReused: number;
    confirmed: number;
    /** null when there is nothing to divide by. */
    rate: number | null;
  };
  tickets: {
    created: number;
    byStatus: Record<TicketStatus, number>;
    byCategory: Partial<Record<TicketCategory, number>>;
    duplicatesPrevented: number;
    addedToKnowledgeBase: number;
  };
  timing: {
    medianToFirstModeratorActionMs: number | null;
    awaitingFirstModeratorAction: number;
    medianToResolutionMs: number | null;
    resolved: number;
  };
  topUnresolvedIssues: UnresolvedIssue[];
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Canonical issues come from the classifier ("Prize: payment not received"); case and
// trailing punctuation vary between calls, so they are compared loosely.
const issueKey = (issue: string) => issue.trim().toLowerCase().replace(/[.\s]+$/, '').replace(/\s+/g, ' ');

export function computeSupportMetrics(events: EventFact[], tickets: TicketFact[], options: { topIssues?: number } = {}): SupportMetrics {
  const count = (type: SupportEventType) => events.filter(e => e.type === type).length;

  const byOutcome = Object.fromEntries(Object.values(QUESTION_OUTCOMES).map(o => [o, 0])) as Record<QuestionOutcome, number>;
  for (const e of events) {
    const outcome = QUESTION_OUTCOMES[e.type as keyof typeof QUESTION_OUTCOMES];
    if (outcome) byOutcome[outcome]++;
  }

  const answersMarkedHelpful = count('answer_marked_helpful');
  const resolutionsReused = count('resolution_reused');
  const confirmed = answersMarkedHelpful + resolutionsReused;
  const selfServeDenominator = confirmed + tickets.length;

  const byStatus: Record<TicketStatus, number> = { open: 0, assigned: 0, waiting_user: 0, resolved: 0 };
  const byCategory: Partial<Record<TicketCategory, number>> = {};
  for (const t of tickets) {
    byStatus[t.status]++;
    byCategory[t.category] = (byCategory[t.category] ?? 0) + 1;
  }

  const firstAction = tickets.filter(t => t.firstModeratorActionAt)
    .map(t => t.firstModeratorActionAt!.getTime() - t.createdAt.getTime());
  const resolved = tickets.filter(t => t.status === 'resolved' && t.resolvedAt);
  const toResolution = resolved.map(t => t.resolvedAt!.getTime() - t.createdAt.getTime());

  const groups = new Map<string, UnresolvedIssue>();
  for (const t of tickets) {
    if (t.status === 'resolved') continue;
    const key = issueKey(t.canonicalIssue);
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { canonicalIssue: t.canonicalIssue, tickets: 1, ticketNumbers: [t.number], oldestCreatedAt: t.createdAt });
      continue;
    }
    group.tickets++;
    group.ticketNumbers.push(t.number);
    if (t.createdAt < group.oldestCreatedAt) {
      group.oldestCreatedAt = t.createdAt;
      group.canonicalIssue = t.canonicalIssue;
    }
  }
  const topUnresolvedIssues = [...groups.values()]
    .map(g => ({ ...g, ticketNumbers: g.ticketNumbers.sort((a, b) => a - b) }))
    // Most tickets first; among equals, the one waiting longest.
    .sort((a, b) => b.tickets - a.tickets || a.oldestCreatedAt.getTime() - b.oldestCreatedAt.getTime())
    .slice(0, options.topIssues ?? 5);

  return {
    questions: { total: Object.values(byOutcome).reduce((a, b) => a + b, 0), byOutcome },
    selfServe: {
      answersMarkedHelpful,
      resolutionsReused,
      confirmed,
      rate: selfServeDenominator ? confirmed / selfServeDenominator : null
    },
    tickets: {
      created: tickets.length,
      byStatus,
      byCategory,
      duplicatesPrevented: count('duplicate_prevented'),
      addedToKnowledgeBase: tickets.filter(t => t.addedToKnowledgeBase).length
    },
    timing: {
      medianToFirstModeratorActionMs: median(firstAction),
      awaitingFirstModeratorAction: tickets.length - firstAction.length,
      medianToResolutionMs: median(toResolution),
      resolved: resolved.length
    },
    topUnresolvedIssues
  };
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return 'n/a';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
