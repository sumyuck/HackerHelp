import { getSupabase } from './knowledge.service';
import type { SimilarTicket } from '../tickets/dedup-policy';
import type { TicketStatus } from '../tickets/ticket-state';

/**
 * Ticket vectors in pgvector, used only for duplicate detection. Ticket records live in MongoDB.
 * Vectors embed the classifier's canonical issue. Thresholds are from npm run eval:dedup:
 * at 0.80, 9/12 labelled duplicates were found with 0/12 false matches.
 */

export function dedupThresholds() {
  return {
    duplicate: Number(process.env.TICKET_DUPLICATE_SIMILARITY ?? 0.8),
    related: Number(process.env.TICKET_RELATED_SIMILARITY ?? 0.65)
  };
}

export async function findSimilarTickets(guildId: string, embedding: number[], minSimilarity: number): Promise<SimilarTicket[]> {
  const { data, error } = await getSupabase().rpc('match_tickets', {
    query_embedding: embedding,
    p_guild_id: guildId,
    match_threshold: minSimilarity,
    match_count: 5
  });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    ticketId: row.ticket_id,
    ticketNumber: row.ticket_number,
    creatorId: row.creator_id,
    status: row.status as TicketStatus,
    similarity: Number(row.similarity)
  }));
}

export async function upsertTicketEmbedding(ticket: {
  id: string; guildId: string; number: number; creatorId: string; status: TicketStatus;
}, embedding: number[]): Promise<void> {
  const { error } = await getSupabase().from('ticket_embeddings').upsert({
    ticket_id: ticket.id,
    guild_id: ticket.guildId,
    ticket_number: ticket.number,
    creator_id: ticket.creatorId,
    status: ticket.status,
    embedding,
    updated_at: new Date().toISOString()
  });
  if (error) throw error;
}

export async function updateTicketEmbeddingStatus(ticketId: string, status: TicketStatus): Promise<void> {
  const { error } = await getSupabase()
    .from('ticket_embeddings')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('ticket_id', ticketId);
  if (error) throw error;
}
