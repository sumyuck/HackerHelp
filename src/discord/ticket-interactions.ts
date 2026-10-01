import {
  ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction,
  EmbedBuilder, GuildMember, Message, MessageFlags
} from 'discord.js';
import { logger } from '../logger';
import { ITicketDocument } from '../database/ticket.models';
import { answerQuestion, AnswerResult } from '../services/answer.service';
import {
  applyTicketAction, findTicket, getPendingRequest, listOpenTicketsFor, OpenTicketInput, openTicket,
  recordEvent, savePendingRequest
} from '../services/ticket.service';
import type { TicketAction } from '../tickets/ticket-state';
import { buildAnswerEmbed } from './answer-presenter';
import { buildTicketEmbed, forumTicketChannel, isModerator, ticketForumId, ticketsEnabled } from './ticket-forum';

/**
 * Discord entry points for support: answer → optional handoff → ticket.
 *
 *  /ask or @mention → answered    → [This solved it] [I still need help]
 *                   → escalated   → [Open a ticket]
 *  /ticket open     → tries an answer first (deflection), then opens a ticket
 *  similar resolved ticket found  → [That solved it] [No, open a ticket]
 *
 * Button custom IDs carry only a pending-request ID; the question and triage
 * result are stored server-side (see PendingTicketRequest).
 */

const OUTCOME_EVENT = {
  answered: 'question_answered',
  clarify: 'question_clarified',
  escalate: 'question_escalated',
  out_of_scope: 'question_out_of_scope',
  refused: 'question_refused',
  error: 'question_error'
} as const;

const contextOf = (result: AnswerResult) =>
  result.retrieved.slice(0, 3).map(s => ({ slug: s.documentSlug, title: s.documentTitle, similarity: s.similarity }));

function button(id: string, label: string, style: ButtonStyle) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
}

/**
 * Records the outcome and returns follow-up buttons for an answer. Stores the
 * context needed to open a ticket later, keyed by the originating interaction or message.
 */
export async function supportFollowUp(
  result: AnswerResult,
  source: { id: string; guildId: string | null; userId: string; userTag: string; question: string }
): Promise<ActionRowBuilder<ButtonBuilder>[]> {
  if (!source.guildId) return [];
  await recordEvent({ guildId: source.guildId, type: OUTCOME_EVENT[result.outcome], userId: source.userId, category: result.category ?? undefined, reason: result.reason });

  const offerTicket = ticketsEnabled() && (result.outcome === 'escalate' || result.outcome === 'answered' || result.outcome === 'error');
  if (!offerTicket) return [];

  await savePendingRequest({
    id: source.id,
    guildId: source.guildId,
    userId: source.userId,
    userTag: source.userTag,
    question: source.question,
    escalationReason: result.outcome === 'answered' ? 'user_requested_after_answer' : result.reason,
    sensitiveCategory: result.category,
    priority: result.priority,
    context: contextOf(result)
  });

  const row = new ActionRowBuilder<ButtonBuilder>();
  if (result.outcome === 'answered') {
    row.addComponents(
      button(`tk:solved:${source.id}`, 'This solved it', ButtonStyle.Success),
      button(`tk:anyway:${source.id}`, 'I still need help', ButtonStyle.Secondary)
    );
  } else {
    row.addComponents(button(`tk:open:${source.id}`, 'Open a ticket', ButtonStyle.Primary));
  }
  return [row];
}

function ticketLink(ticket: ITicketDocument): string {
  const url = forumTicketChannel.threadUrl(ticket);
  return url ? `[#${ticket.number}](${url})` : `#${ticket.number}`;
}

type TicketReply = { content?: string; embeds?: EmbedBuilder[]; components?: ActionRowBuilder<ButtonBuilder>[] };

/** Returns the reply plus whether a ticket now exists (so the originating buttons can be removed). */
async function runOpenTicket(input: OpenTicketInput): Promise<{ reply: TicketReply; ticketExists: boolean }> {
  const outcome = await openTicket(input, forumTicketChannel);
  switch (outcome.kind) {
    case 'created':
      return { ticketExists: true, reply: { content: `🎫 Opened ticket ${ticketLink(outcome.ticket)}. A moderator will follow up in that thread. Please don't share personal or payment details there.` } };
    case 'existing':
      return { ticketExists: true, reply: {
        content: outcome.why === 'own_duplicate'
          ? `You already have an open ticket about this: ${ticketLink(outcome.ticket)}. Add any new details there so they stay together.`
          : `Your ticket is ${ticketLink(outcome.ticket)}.`
      } };
    case 'suggest_resolution': {
      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle(`A similar question was already answered (ticket #${outcome.ticket.number})`)
        .setDescription(outcome.ticket.resolution!.slice(0, 4000))
        .setFooter({ text: `Similarity ${outcome.similarity.toFixed(2)} · if this doesn't fit your case, open a ticket anyway.` });
      return { ticketExists: false, reply: {
        embeds: [embed],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
          button(`tk:reused:${input.sourceKey}`, 'That solved it', ButtonStyle.Success),
          button(`tk:anyway:${input.sourceKey}`, 'No, open a ticket', ButtonStyle.Secondary)
        )]
      } };
    }
  }
}

export async function handleTicketButton(interaction: ButtonInteraction): Promise<void> {
  const [, kind, pendingId] = interaction.customId.split(':');
  const pending = await getPendingRequest(pendingId);
  if (!pending) {
    await interaction.reply({ content: 'This button has expired. Run `/ticket open` to start a new ticket.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (pending.userId !== interaction.user.id) {
    await interaction.reply({ content: 'Only the person who asked can use these buttons. Use `/ask` or `/ticket open` for your own question.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (kind === 'solved' || kind === 'reused') {
    await recordEvent({ guildId: pending.guildId, type: kind === 'solved' ? 'answer_marked_helpful' : 'resolution_reused', userId: pending.userId });
    await interaction.update({ components: [] });
    await interaction.followUp({ content: 'Glad that helped! 🎉', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { reply, ticketExists } = await runOpenTicket({
    // Same key for every press of this message's buttons: double clicks and retries reuse one ticket.
    sourceKey: pending._id,
    guildId: pending.guildId,
    creatorId: pending.userId,
    creatorTag: pending.userTag,
    question: pending.question,
    escalationReason: pending.escalationReason,
    sensitiveCategory: pending.sensitiveCategory as OpenTicketInput['sensitiveCategory'],
    priority: pending.priority,
    context: pending.context,
    forceCreate: kind === 'anyway'
  });
  await interaction.editReply(reply);
  // Once a ticket exists, the original buttons are spent.
  if (ticketExists) {
    await interaction.message.edit({ components: [] }).catch(() => undefined);
  }
}

async function resolveTicketRef(interaction: ChatInputCommandInteraction): Promise<ITicketDocument | null> {
  const number = interaction.options.getInteger('number');
  if (number) return findTicket(interaction.guildId!, { number });
  // Look up by channel ID rather than inspecting interaction.channel: that reads the gateway
  // cache, which has no entry for archived threads or threads created before a restart.
  return findTicket(interaction.guildId!, { threadId: interaction.channelId });
}

export async function handleTicketCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: 'Tickets are only available inside the server.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!ticketsEnabled()) {
    await interaction.reply({ content: 'Tickets are not configured on this server yet.', flags: MessageFlags.Ephemeral });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (subcommand === 'open') {
    const issue = interaction.options.getString('issue', true);
    // Deflection: if the knowledge base answers it, show that first with a one-click escape hatch.
    const result = await answerQuestion(issue);
    const source = { id: interaction.id, guildId: interaction.guildId, userId: interaction.user.id, userTag: interaction.user.tag, question: issue };
    if (result.outcome === 'answered') {
      const components = await supportFollowUp(result, source);
      await interaction.editReply({ content: 'Before opening a ticket, this might answer it:', embeds: [buildAnswerEmbed(result, issue)], components });
      return;
    }
    if (result.outcome === 'clarify' || result.outcome === 'out_of_scope' || result.outcome === 'refused') {
      await recordEvent({ guildId: interaction.guildId, type: OUTCOME_EVENT[result.outcome], userId: interaction.user.id, reason: result.reason });
      await interaction.editReply({ embeds: [buildAnswerEmbed(result, issue)] });
      return;
    }
    await recordEvent({ guildId: interaction.guildId, type: OUTCOME_EVENT[result.outcome], userId: interaction.user.id, category: result.category ?? undefined, reason: result.reason });
    const { reply } = await runOpenTicket({
      sourceKey: interaction.id,
      guildId: interaction.guildId,
      creatorId: interaction.user.id,
      creatorTag: interaction.user.tag,
      question: issue,
      escalationReason: result.reason,
      sensitiveCategory: result.category,
      priority: result.priority,
      context: contextOf(result)
    });
    await interaction.editReply(reply);
    return;
  }

  if (subcommand === 'status') {
    const ticket = await resolveTicketRef(interaction);
    if (!ticket && !interaction.options.getInteger('number')) {
      const tickets = await listOpenTicketsFor(interaction.guildId, interaction.user.id);
      await interaction.editReply({
        content: tickets.length
          ? `Your open tickets:\n${tickets.map(t => `• ${ticketLink(t)} ${t.title} · ${t.status.replace('_', ' ')}`).join('\n')}`
          : 'You have no open tickets.'
      });
      return;
    }
    await interaction.editReply(ticket ? { embeds: [buildTicketEmbed(ticket)] } : { content: 'Ticket not found.' });
    return;
  }

  const ticket = await resolveTicketRef(interaction);
  if (!ticket) {
    await interaction.editReply({ content: 'Ticket not found. Pass `number`, or run this inside the ticket thread.' });
    return;
  }

  const member = interaction.member instanceof GuildMember ? interaction.member : null;
  const actor = { id: interaction.user.id, isModerator: await isModerator(member, interaction.user.id) };
  const actions: Record<string, TicketAction> = { assign: 'assign', waiting: 'wait_for_user', resolve: 'resolve', reopen: 'reopen' };
  const action = actions[subcommand];

  const result = await applyTicketAction(ticket, action, actor, forumTicketChannel, {
    assigneeId: interaction.options.getUser('user')?.id,
    note: interaction.options.getString('note') ?? undefined,
    resolution: interaction.options.getString('resolution') ?? undefined,
    addToKnowledgeBase: interaction.options.getBoolean('add_to_knowledge_base') ?? false
  });
  if (!result.ok) {
    await interaction.editReply({ content: result.error });
    return;
  }
  const extra = action === 'resolve' && result.ticket.addedToKnowledgeBase
    ? ' The resolution was added to the knowledge base, so similar questions will now be answered automatically.'
    : '';
  await interaction.editReply({ content: `Ticket ${ticketLink(result.ticket)} is now **${result.ticket.status.replace('_', ' ')}**.${extra}` });
}

/** When the participant replies in a ticket that was waiting on them, hand it back to the assignee. */
export async function handleTicketThreadMessage(message: Message): Promise<void> {
  if (!message.guildId) return;
  // Cheap filter first: a cached thread outside the ticket forum is never a ticket. An uncached
  // channel (thread from before a restart) falls through to the indexed threadId lookup.
  const channel = message.channel;
  if (channel.isThread() ? channel.parentId !== ticketForumId() : !channel.partial) return;
  const ticket = await findTicket(message.guildId, { threadId: message.channelId });
  if (!ticket || ticket.status !== 'waiting_user' || ticket.creatorId !== message.author.id) return;
  const result = await applyTicketAction(ticket, 'user_replied', { id: message.author.id, isModerator: false }, forumTicketChannel);
  if (!result.ok) logger.warn('Could not move ticket back from waiting_user', { ticket: ticket.number, error: result.error });
}
