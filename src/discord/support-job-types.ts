import type { ButtonInteraction, ChatInputCommandInteraction, Message } from 'discord.js';
import type { AnswerResult } from '../services/answer.service';
import { DELIVERY_DEADLINE_MS } from '../queue/retry-policy';

/** Where a job's reply goes: the deferred interaction response, or a reply to a message. */
export type ReplyTarget =
  | { type: 'interaction'; applicationId: string; token: string }
  | { type: 'message'; channelId: string; messageId: string };

export interface Requester {
  guildId: string | null;
  userId: string;
  userTag: string;
}

/** Progress checkpointed into the job, so retries skip finished steps. */
export interface SupportJobState {
  answer: AnswerResult;
  delivered: boolean;
}

interface JobBase {
  sourceId: string;
  deadlineAt: number;
  target: ReplyTarget;
  requester: Requester;
  state?: Partial<SupportJobState>;
}

export type SupportJob =
  /** /ask or an @mention. */
  | (JobBase & { kind: 'answer'; question: string })
  /** /ticket open: try the knowledge base first, then open a ticket. */
  | (JobBase & { kind: 'ticket_open'; issue: string })
  /** "Open a ticket" / "I still need help" buttons. */
  | (JobBase & { kind: 'ticket_request'; pendingId: string; forceCreate: boolean; buttonMessage: { channelId: string; messageId: string } });

export function jobFromInteraction(interaction: ChatInputCommandInteraction | ButtonInteraction): JobBase {
  return {
    sourceId: interaction.id,
    deadlineAt: interaction.createdTimestamp + DELIVERY_DEADLINE_MS,
    target: { type: 'interaction', applicationId: interaction.applicationId, token: interaction.token },
    requester: { guildId: interaction.guildId, userId: interaction.user.id, userTag: interaction.user.tag }
  };
}

export function jobFromMessage(message: Message): JobBase {
  return {
    sourceId: message.id,
    deadlineAt: message.createdTimestamp + DELIVERY_DEADLINE_MS,
    target: { type: 'message', channelId: message.channelId, messageId: message.id },
    requester: { guildId: message.guildId, userId: message.author.id, userTag: message.author.tag }
  };
}
