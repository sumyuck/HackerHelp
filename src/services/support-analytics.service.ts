import { SupportEvent, Ticket } from '../database/ticket.models';
import { computeSupportMetrics, EventFact, SupportMetrics, TicketFact } from '../analytics/support-metrics';

export const MAX_ANALYTICS_DAYS = 365;

export interface SupportReport {
  guildId: string;
  days: number;
  since: Date;
  metrics: SupportMetrics;
}

/**
 * Loads one guild's facts for the last `days` days and computes the report.
 * Events are projected to their type and tickets to the fields the metrics use,
 * so a window holds a few small documents per question; one Discord server's
 * volume fits comfortably in memory. At larger scale this becomes a $group aggregation.
 */
export async function getSupportReport(guildId: string, days = 30): Promise<SupportReport> {
  const window = Math.min(Math.max(Math.floor(days), 1), MAX_ANALYTICS_DAYS);
  const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000);

  const [events, tickets] = await Promise.all([
    SupportEvent.find({ guildId, createdAt: { $gte: since } }, { _id: 0, type: 1 }).lean<EventFact[]>(),
    Ticket.find(
      { guildId, createdAt: { $gte: since } },
      { _id: 0, number: 1, canonicalIssue: 1, category: 1, status: 1, createdAt: 1, firstModeratorActionAt: 1, resolvedAt: 1, addedToKnowledgeBase: 1 }
    ).lean<TicketFact[]>()
  ]);

  return { guildId, days: window, since, metrics: computeSupportMetrics(events, tickets) };
}
