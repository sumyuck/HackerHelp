import { 
  Client, 
  Events,
  GatewayIntentBits,
  Interaction, 
  Message,
  Partials 
} from 'discord.js';
import { handleSlashCommandInteraction, handleRegisterModalSubmit } from './commands-handler';
import { answerQuestion } from '../services/answer.service';
import { buildAnswerEmbed } from './answer-presenter';
import { logger } from '../logger';

// Initialize client with required intents
export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [
    Partials.Channel,
    Partials.Message
  ]
});

/**
 * Boots the Discord Bot.
 */
export async function startDiscordBot(): Promise<void> {
  const token = process.env.DISCORD_TOKEN;
  if (!token || token === 'mock_discord_token') {
    logger.warn('Skipping Discord Bot startup: No valid DISCORD_TOKEN provided in env configurations.');
    return;
  }

  // Event: Ready
  client.once(Events.ClientReady, (readyClient) => {
    logger.info(`Discord Bot connected and ready as user: ${readyClient.user.tag}`);
  });

  // Event: Interaction Creation (Slash Commands & Modals)
  client.on('interactionCreate', async (interaction: Interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await handleSlashCommandInteraction(interaction);
      } else if (interaction.isModalSubmit() && interaction.customId === 'register_modal') {
        await handleRegisterModalSubmit(interaction);
      }
    } catch (error) {
      // Last-resort guard: an escaped handler error must not become an unhandled rejection.
      logger.error('Unhandled error while processing interaction', { interactionId: interaction.id, error });
    }
  });

  // Event: Message Creation (AI assistant mentions)
  client.on('messageCreate', async (message: Message) => {
    if (message.author.bot) return;

    const botUser = client.user;
    // Direct mentions only: mentions.has() is also true for @everyone and role pings,
    // which would make the bot answer every server-wide announcement.
    if (!botUser || !message.mentions.users.has(botUser.id)) return;

    const mentionRegex = new RegExp(`<@!?${botUser.id}>`, 'g');
    const question = message.content.replace(mentionRegex, '').trim();

    try {
      if (!question) {
        await message.reply({
          content: 'Hi! I\'m HackerHelp. Ask me anything about HackerRank Orchestrate (dates, rules, submissions, the AI judge interview, prizes), or use `/ask`.',
          allowedMentions: { repliedUser: true }
        });
        return;
      }

      if ('sendTyping' in message.channel) await message.channel.sendTyping();
      const result = await answerQuestion(question);
      await message.reply({ embeds: [buildAnswerEmbed(result)], allowedMentions: { repliedUser: true } });
    } catch (error) {
      logger.error('Failed to answer mention message', { messageId: message.id, error });
      await message.reply({
        content: 'Sorry, something went wrong. Please try again in a moment.',
        allowedMentions: { repliedUser: true }
      }).catch(replyError => logger.error('Failed to send fallback reply', { error: replyError }));
    }
  });

  // A bot that cannot log in is useless; let bootstrap fail so the orchestrator restarts or alerts.
  await client.login(token);
}

/** Closes the gateway connection so Discord marks the bot offline promptly. */
export async function stopDiscordBot(): Promise<void> {
  if (client.isReady()) await client.destroy();
}
