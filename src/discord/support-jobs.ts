import { ActionRowBuilder, ButtonBuilder, Client, EmbedBuilder, InteractionWebhook, Routes } from 'discord.js';
import { userMessage } from '../errors';
import { logger } from '../logger';
import type { JobContext } from '../queue/retry-policy';
import type { SupportJobHandlers } from '../queue/support-queue';
import { answerQuestion, AnswerResult } from '../services/answer.service';
import { buildAnswerEmbed } from './answer-presenter';
import type { ReplyTarget, SupportJob, SupportJobState } from './support-job-types';
import { supportFollowUp, SupportSource, ticketOpenReply, ticketRequestReply } from './ticket-interactions';

/**
 * Processors for support jobs. Every step is safe to repeat, because a job can
 * run more than once (retry, stalled worker, enqueue timeout fallback):
 *  - the answer is checkpointed, so a retry does not call the model again;
 *  - support events carry a dedupe key, pending requests are upserts, and
 *    tickets are keyed by the originating interaction (sourceKey);
 *  - interaction replies edit the deferred response, which is naturally idempotent;
 *    message replies send a nonce Discord deduplicates (enforceNonce), and a
 *    `delivered` checkpoint stops later retries from sending again.
 */

export interface ReplyPayload {
  content?: string;
  embeds?: EmbedBuilder[];
  components?: ActionRowBuilder<ButtonBuilder>[];
}

export interface SupportDelivery {
  send(target: ReplyTarget, payload: ReplyPayload, nonce: string): Promise<void>;
  clearButtons(channelId: string, messageId: string): Promise<void>;
}

export interface SupportJobDeps {
  answer: typeof answerQuestion;
  followUp: typeof supportFollowUp;
  ticketOpenReply: typeof ticketOpenReply;
  ticketRequestReply: typeof ticketRequestReply;
  delivery: SupportDelivery;
}

type Ctx = JobContext<SupportJobState>;

const sourceOf = (job: SupportJob, question: string): SupportSource => ({ id: job.sourceId, ...job.requester, question });

export function createSupportJobHandlers(deps: SupportJobDeps): SupportJobHandlers<SupportJob> {
  async function answerOnce(question: string, ctx: Ctx): Promise<AnswerResult> {
    if (ctx.state.answer) return ctx.state.answer;
    // Upstream outages are rethrown while a retry is still possible; on the last chance
    // the pipeline degrades to its "busy" answer, which offers a ticket.
    const result = await deps.answer(question, { rethrowIf: error => ctx.willRetry(error) });
    await ctx.checkpoint({ answer: result });
    return result;
  }

  async function deliver(job: SupportJob, ctx: Ctx, payload: ReplyPayload): Promise<void> {
    if (ctx.state.delivered) return;
    await deps.delivery.send(job.target, payload, job.sourceId);
    await ctx.checkpoint({ delivered: true });
  }

  return {
    async process(job, ctx) {
      switch (job.kind) {
        case 'answer': {
          const result = await answerOnce(job.question, ctx);
          const components = await deps.followUp(result, sourceOf(job, job.question));
          // Slash-command replies restate the question; a mention reply sits under it already.
          const embed = buildAnswerEmbed(result, job.target.type === 'interaction' ? job.question : undefined);
          await deliver(job, ctx, { embeds: [embed], components });
          return;
        }
        case 'ticket_open': {
          if (!job.requester.guildId) throw new Error('ticket_open job without a guild');
          const result = await answerOnce(job.issue, ctx);
          const reply = await deps.ticketOpenReply(result, { ...sourceOf(job, job.issue), guildId: job.requester.guildId });
          await deliver(job, ctx, reply);
          return;
        }
        case 'ticket_request': {
          const { reply, ticketExists } = await deps.ticketRequestReply(job.pendingId, job.forceCreate);
          await deliver(job, ctx, reply);
          // Once a ticket exists, the original buttons are spent.
          if (ticketExists) {
            await deps.delivery.clearButtons(job.buttonMessage.channelId, job.buttonMessage.messageId)
              .catch(error => logger.warn('Could not remove spent ticket buttons', { detail: error?.message }));
          }
          return;
        }
      }
    },

    async onFinalFailure(job, error) {
      if (job.state?.delivered) return;
      // A distinct nonce: this must not be swallowed as a duplicate of the answer it replaces.
      await deps.delivery.send(job.target, { content: userMessage(error), embeds: [], components: [] }, `${job.sourceId}f`);
    }
  };
}

export function discordDelivery(client: Client): SupportDelivery {
  return {
    async send(target, payload, nonce) {
      if (target.type === 'interaction') {
        // Webhook edit by token: works from any process, no gateway cache needed.
        await new InteractionWebhook(client as Client<true>, target.applicationId, target.token).editMessage('@original', payload);
        return;
      }
      const channel = await client.channels.fetch(target.channelId);
      if (!channel?.isSendable()) throw new Error(`Channel ${target.channelId} is not sendable`);
      await channel.send({
        ...payload,
        reply: { messageReference: target.messageId, failIfNotExists: false },
        allowedMentions: { repliedUser: true },
        nonce,
        enforceNonce: true
      });
    },
    async clearButtons(channelId, messageId) {
      await client.rest.patch(Routes.channelMessage(channelId, messageId), { body: { components: [] } });
    }
  };
}

export function defaultSupportJobHandlers(client: Client): SupportJobHandlers<SupportJob> {
  return createSupportJobHandlers({
    answer: answerQuestion,
    followUp: supportFollowUp,
    ticketOpenReply,
    ticketRequestReply,
    delivery: discordDelivery(client)
  });
}
