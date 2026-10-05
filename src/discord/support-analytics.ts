import { ChatInputCommandInteraction, EmbedBuilder, GuildMember, MessageFlags } from 'discord.js';
import { formatDuration, SupportMetrics } from '../analytics/support-metrics';
import { CATEGORY_LABELS } from '../services/ticket.service';
import { getSupportReport } from '../services/support-analytics.service';
import { isModerator, STATUS_LABELS } from './ticket-forum';

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : 'n/a');

function lines(entries: [string, number][]): string {
  const shown = entries.filter(([, n]) => n > 0);
  return shown.length ? shown.map(([label, n]) => `${label}: **${n}**`).join('\n') : 'None';
}

export function buildAnalyticsEmbed(metrics: SupportMetrics, days: number): EmbedBuilder {
  const { questions: q, selfServe, tickets, timing } = metrics;
  const outcomes: [string, number][] = [
    ['Answered', q.byOutcome.answered],
    ['Asked to clarify', q.byOutcome.clarify],
    ['Escalated', q.byOutcome.escalated],
    ['Out of scope', q.byOutcome.out_of_scope],
    ['Refused (injection)', q.byOutcome.refused],
    ['Errors', q.byOutcome.error]
  ];
  const issues = metrics.topUnresolvedIssues.length
    ? metrics.topUnresolvedIssues
        .map(i => `**${i.tickets}×** ${i.canonicalIssue.slice(0, 120)} (${i.ticketNumbers.slice(0, 5).map(n => `#${n}`).join(', ')})`)
        .join('\n')
    : 'None';

  return new EmbedBuilder()
    .setColor(0x1ba94c)
    .setTitle(`Support analytics: last ${days} day${days === 1 ? '' : 's'}`)
    .addFields(
      { name: `Questions (${q.total})`, value: lines(outcomes), inline: true },
      {
        name: 'Self-serve',
        value: [
          `Answers marked helpful: **${selfServe.answersMarkedHelpful}** (${pct(selfServe.answersMarkedHelpful, q.byOutcome.answered)} of answers)`,
          `Past resolutions reused: **${selfServe.resolutionsReused}**`,
          `Self-serve rate: **${selfServe.rate === null ? 'n/a' : `${Math.round(selfServe.rate * 100)}%`}**`
        ].join('\n'),
        inline: true
      },
      { name: `Tickets (${tickets.created})`, value: lines(Object.entries(tickets.byStatus).map(([s, n]) => [STATUS_LABELS[s as keyof typeof STATUS_LABELS], n])), inline: true },
      { name: 'By category', value: lines(Object.entries(tickets.byCategory).map(([c, n]) => [CATEGORY_LABELS[c as keyof typeof CATEGORY_LABELS], n!])), inline: true },
      {
        name: 'Moderator load',
        value: [
          `Duplicates prevented: **${tickets.duplicatesPrevented}**`,
          `Resolutions added to knowledge: **${tickets.addedToKnowledgeBase}**`,
          `Median to first moderator action: **${formatDuration(timing.medianToFirstModeratorActionMs)}** (${timing.awaitingFirstModeratorAction} still waiting)`,
          `Median to resolution: **${formatDuration(timing.medianToResolutionMs)}** (${timing.resolved} resolved)`
        ].join('\n'),
        inline: true
      },
      { name: 'Top unresolved issues', value: issues.slice(0, 1024) }
    )
    .setFooter({ text: 'Self-serve counts only explicit "solved it" clicks, so it is a lower bound. Tickets are those created in this window.' });
}

/** /analytics [days]: moderator-only, ephemeral. */
export async function handleAnalyticsCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: 'Run this inside the server.', flags: MessageFlags.Ephemeral });
    return;
  }
  const member = interaction.member instanceof GuildMember ? interaction.member : null;
  if (!(await isModerator(member, interaction.user.id))) {
    await interaction.reply({ content: 'Only moderators can view support analytics.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const report = await getSupportReport(interaction.guildId, interaction.options.getInteger('days') ?? 30);
  await interaction.editReply({ embeds: [buildAnalyticsEmbed(report.metrics, report.days)] });
}
