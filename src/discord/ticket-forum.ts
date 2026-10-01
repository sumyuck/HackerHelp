import {
  ChannelType, Client, EmbedBuilder, ForumChannel, GuildMember, ThreadChannel
} from 'discord.js';
import { logger } from '../logger';
import { ITicketDocument, TICKET_CATEGORIES } from '../database/ticket.models';
import { CATEGORY_LABELS, TicketChannel } from '../services/ticket.service';
import { hasRole } from '../services/user.service';
import type { TicketStatus } from '../tickets/ticket-state';

/**
 * Tickets live as posts in a forum channel (the Orchestrate server's
 * #hacker-help-desk), tagged by category and status, with the moderator role
 * pinged on creation. The forum and role are resolved once at startup, by ID
 * or by name, and missing tags are created.
 */

const STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Open', assigned: 'Assigned', waiting_user: 'Waiting on participant', resolved: 'Resolved'
};
const PRIORITY_COLORS = { low: 0x95a5a6, normal: 0x3498db, high: 0xe67e22, urgent: 0xe74c3c } as const;

interface ForumState {
  guildId: string;
  forum: ForumChannel;
  moderatorRoleId: string | null;
  tagIds: Map<string, string>;
}

let state: ForumState | null = null;

export function ticketsEnabled(): boolean {
  return state !== null;
}

export function ticketForumId(): string | null {
  return state?.forum.id ?? null;
}

const matches = (value: string) => (item: { id: string; name: string }) =>
  item.id === value || item.name.toLowerCase() === value.toLowerCase();

export async function initTicketForum(client: Client): Promise<void> {
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  const forumRef = process.env.TICKET_FORUM_CHANNEL?.trim() || 'hacker-help-desk';
  const roleRef = process.env.TICKET_MODERATOR_ROLE?.trim() || 'Moderator';
  if (!guildId) {
    logger.warn('Tickets disabled: DISCORD_GUILD_ID is required to locate the ticket forum.');
    return;
  }

  try {
    const guild = await client.guilds.fetch(guildId);
    const channels = await guild.channels.fetch();
    const forum = channels.find(c => c?.type === ChannelType.GuildForum && matches(forumRef)(c)) as ForumChannel | undefined;
    if (!forum) {
      logger.warn(`Tickets disabled: no forum channel matching "${forumRef}" in guild ${guildId}.`);
      return;
    }
    const role = (await guild.roles.fetch()).find(matches(roleRef)) ?? null;
    if (!role) logger.warn(`No role matching "${roleRef}"; new tickets will not ping moderators.`);

    // Ensure every category and status has a tag (forums allow up to 20).
    const wanted = [...TICKET_CATEGORIES.map(c => CATEGORY_LABELS[c]), ...Object.values(STATUS_LABELS)];
    const existing = new Set(forum.availableTags.map(t => t.name));
    const missing = wanted.filter(name => !existing.has(name));
    let ready = forum;
    if (missing.length) {
      ready = await forum.setAvailableTags([...forum.availableTags, ...missing.map(name => ({ name }))]);
      logger.info('Created ticket forum tags', { missing });
    }
    const tagIds = new Map(ready.availableTags.map(t => [t.name, t.id]));

    state = { guildId, forum: ready, moderatorRoleId: role?.id ?? null, tagIds };
    logger.info('Ticket forum ready', { forum: forum.name, moderatorRole: role?.name ?? null });
  } catch (error: any) {
    logger.error('Tickets disabled: could not initialise the ticket forum (check Manage Channels / Manage Threads permissions).', { detail: error?.message });
  }
}

export async function isModerator(member: GuildMember | null, userId: string): Promise<boolean> {
  if (state?.moderatorRoleId && member?.roles.cache.has(state.moderatorRoleId)) return true;
  return hasRole(userId, ['super_admin', 'event_admin']);
}

function tagsFor(ticket: ITicketDocument): string[] {
  return [CATEGORY_LABELS[ticket.category], STATUS_LABELS[ticket.status]]
    .map(name => state?.tagIds.get(name))
    .filter((id): id is string => !!id);
}

export function describeEscalation(reason: string): string {
  if (reason.startsWith('deterministic_gate:')) return `Safety rule: ${reason.split(':')[1].replace(/_/g, ' ')} is always handled by staff.`;
  if (reason.startsWith('validation_downgrade:')) return 'The bot drafted an answer, but it failed the citation checks.';
  if (reason.startsWith('model_refusal')) return 'The model declined to answer.';
  if (reason.startsWith('model:escalate')) return `The docs do not cover this. ${reason.replace(/^model:escalate \(|\)$/g, '')}`;
  if (reason.startsWith('upstream_unavailable') || reason === 'model_failed' || reason === 'retrieval_failed') return 'The bot was unavailable, so it went straight to a human.';
  if (reason.startsWith('user_requested')) return 'The participant asked for a human after seeing the bot\'s answer.';
  return reason;
}

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function buildTicketEmbed(ticket: ITicketDocument): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(PRIORITY_COLORS[ticket.priority])
    .setTitle(truncate(`#${ticket.number} · ${ticket.title}`, 256))
    .setDescription(truncate(ticket.summary, 4000))
    .addFields(
      { name: 'Status', value: STATUS_LABELS[ticket.status], inline: true },
      { name: 'Priority', value: ticket.priority, inline: true },
      { name: 'Category', value: CATEGORY_LABELS[ticket.category], inline: true },
      { name: 'Opened by', value: `<@${ticket.creatorId}>`, inline: true },
      { name: 'Assignee', value: ticket.assigneeId ? `<@${ticket.assigneeId}>` : 'Unassigned', inline: true },
      { name: 'Why the bot escalated', value: truncate(describeEscalation(ticket.escalationReason), 1024) },
      { name: 'Original message', value: truncate(ticket.question, 1024) }
    );
  if (ticket.context.length) {
    embed.addFields({
      name: 'What the bot found in the docs',
      value: truncate(ticket.context.slice(0, 3).map(c => `• ${c.title} (match ${c.similarity.toFixed(2)})`).join('\n'), 1024)
    });
  }
  if (ticket.relatedTicketNumbers.length) {
    embed.addFields({ name: 'Possibly related', value: ticket.relatedTicketNumbers.map(n => `#${n}`).join(', ') });
  }
  if (ticket.resolution) embed.addFields({ name: 'Resolution', value: truncate(ticket.resolution, 1024) });
  return embed.setFooter({ text: 'Moderators: /ticket assign · /ticket waiting · /ticket resolve' }).setTimestamp(ticket.createdAt);
}

async function fetchThread(ticket: ITicketDocument): Promise<ThreadChannel | null> {
  if (!state || !ticket.threadId) return null;
  const channel = await state.forum.client.channels.fetch(ticket.threadId).catch(() => null);
  return channel?.isThread() ? channel : null;
}

const ACTION_MESSAGES: Record<string, (actorId: string, note?: string) => string> = {
  assign: actorId => `🙋 Assigned to <@${actorId}>.`,
  wait_for_user: (actorId, note) => `⏳ <@${actorId}> is waiting on more information${note ? `: ${note}` : '.'} Reply in this thread to continue.`,
  user_replied: () => '↩️ The participant replied; back with the assignee.',
  resolve: (actorId, note) => `✅ Resolved by <@${actorId}>${note ? `:\n>>> ${note}` : '.'}`,
  reopen: actorId => `🔄 Reopened by <@${actorId}>.`
};

export const forumTicketChannel: TicketChannel = {
  async createThread(ticket) {
    if (!state) throw new Error('Ticket forum is not configured.');
    const ping = state.moderatorRoleId ? `<@&${state.moderatorRoleId}> ` : '';
    const thread = await state.forum.threads.create({
      name: truncate(`#${ticket.number} ${ticket.title}`, 100),
      appliedTags: tagsFor(ticket),
      message: {
        content: `${ping}New **${ticket.priority}** priority ticket from <@${ticket.creatorId}>.`,
        embeds: [buildTicketEmbed(ticket)],
        allowedMentions: { roles: state.moderatorRoleId ? [state.moderatorRoleId] : [], users: [ticket.creatorId] }
      }
    });
    return thread.id;
  },

  async syncThread(ticket, event) {
    const thread = await fetchThread(ticket);
    if (!thread) return;
    // Archived threads reject edits; reopen briefly to post the update.
    if (thread.archived) await thread.setArchived(false);
    const actorShown = event.action === 'assign' ? ticket.assigneeId ?? event.actorId : event.actorId;
    // The participant is pinged when the ball is in their court or the ticket is done.
    const notifyCreator = event.action === 'wait_for_user' || event.action === 'resolve';
    await thread.send({
      content: `${notifyCreator ? `<@${ticket.creatorId}> ` : ''}${ACTION_MESSAGES[event.action](actorShown, event.note)}`,
      allowedMentions: { users: notifyCreator ? [ticket.creatorId] : [] }
    });
    await thread.setAppliedTags(tagsFor(ticket));
    const starter = await thread.fetchStarterMessage().catch(() => null);
    if (starter?.author.id === thread.client.user.id) await starter.edit({ embeds: [buildTicketEmbed(ticket)] });
    if (ticket.status === 'resolved') await thread.setArchived(true);
  },

  threadUrl(ticket) {
    return state && ticket.threadId ? `https://discord.com/channels/${state.guildId}/${ticket.threadId}` : null;
  }
};
