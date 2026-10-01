import { EmbedBuilder } from 'discord.js';
import type { AnswerOutcome, AnswerResult } from '../services/answer.service';

const STYLE: Record<AnswerOutcome, { color: number; title: string }> = {
  answered: { color: 0x2ecc71, title: 'HackerHelp' },
  clarify: { color: 0xf1c40f, title: 'Quick question first' },
  escalate: { color: 0xe67e22, title: 'This needs the HackerRank team' },
  out_of_scope: { color: 0x95a5a6, title: 'Outside what I can help with' },
  refused: { color: 0x95a5a6, title: 'Outside what I can help with' },
  error: { color: 0xe74c3c, title: 'Something went wrong' }
};

const DISCLAIMER = 'Unofficial community assistant. The official event page always takes precedence.';

/** Renders an answer the same way for /ask and @mentions. */
export function buildAnswerEmbed(result: AnswerResult, question?: string): EmbedBuilder {
  const style = STYLE[result.outcome];
  const embed = new EmbedBuilder().setColor(style.color).setTitle(style.title);

  if (question) embed.addFields({ name: 'Question', value: truncate(question, 1024) });
  embed.setDescription(truncate(result.message, 4000));

  if (result.outcome === 'answered' && result.citations.length) {
    const sources = result.citations
      .slice(0, 3)
      .map(citation => (citation.url ? `[${citation.title}](${citation.url})` : citation.title));
    embed.addFields({ name: 'Sources', value: truncate(sources.join('\n'), 1024) });
  }

  const confidence = result.outcome === 'answered' && result.confidence !== null
    ? ` · match ${result.confidence.toFixed(2)}`
    : '';
  embed.setFooter({ text: `${DISCLAIMER}${confidence}` });
  return embed;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
