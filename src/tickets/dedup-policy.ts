import type { TicketStatus } from './ticket-state';

/**
 * Decides what to do with a new ticket given semantically similar existing
 * tickets. Pure, so thresholds and precedence are unit-tested; the similarity
 * search itself lives in ticket-similarity.service.ts.
 *
 * Precedence:
 *  1. The same person already has a similar ticket still open → point them to it
 *     (never create a second one; this also absorbs double-clicks and retries).
 *  2. Someone's similar ticket was resolved → offer that resolution first, with
 *     an explicit "open anyway" escape hatch. A false positive costs one click.
 *  3. Someone else has a similar open ticket → create a new ticket but link it,
 *     so moderators can answer both together. Different people's account-specific
 *     problems often look alike, so this never blocks creation.
 */

export interface SimilarTicket {
  ticketId: string;
  ticketNumber: number;
  creatorId: string;
  status: TicketStatus;
  similarity: number;
}

export type DedupDecision =
  | { action: 'existing_own_ticket'; match: SimilarTicket }
  | { action: 'suggest_resolution'; match: SimilarTicket; related: SimilarTicket[] }
  | { action: 'create'; related: SimilarTicket[] };

export interface DedupThresholds {
  /** Similarity at which two tickets are treated as the same issue. */
  duplicate: number;
  /** Lower bar for listing related tickets to moderators. */
  related: number;
}

export function decideDuplicate(
  creatorId: string,
  candidates: SimilarTicket[],
  thresholds: DedupThresholds,
  options: { forceCreate?: boolean } = {}
): DedupDecision {
  const sorted = [...candidates].sort((a, b) => b.similarity - a.similarity);
  const isOpen = (t: SimilarTicket) => t.status !== 'resolved';
  const related = sorted.filter(t => t.similarity >= thresholds.related).slice(0, 3);

  const ownOpen = sorted.find(t => t.creatorId === creatorId && isOpen(t) && t.similarity >= thresholds.duplicate);
  if (ownOpen) return { action: 'existing_own_ticket', match: ownOpen };

  if (!options.forceCreate) {
    const resolved = sorted.find(t => t.status === 'resolved' && t.similarity >= thresholds.duplicate);
    if (resolved) return { action: 'suggest_resolution', match: resolved, related: related.filter(t => t !== resolved) };
  }

  return { action: 'create', related };
}
