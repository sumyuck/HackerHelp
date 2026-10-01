import { 
  Client, 
  GatewayIntentBits, 
  Interaction, 
  Message,
  Partials 
} from 'discord.js';
import { handleSlashCommandInteraction, handleRegisterModalSubmit } from './commands-handler';
import { askDocMindRAG } from '../services/docmind.service';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console()
  ]
});

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
  client.once('ready', (readyClient) => {
    logger.info(`Discord Bot connected and ready as user: ${readyClient.user.tag}`);
  });

  // Event: Interaction Creation (Slash Commands & Modals)
  client.on('interactionCreate', async (interaction: Interaction) => {
    if (interaction.isChatInputCommand()) {
      await handleSlashCommandInteraction(interaction);
    } 
    else if (interaction.isModalSubmit()) {
      if (interaction.customId === 'register_modal') {
        await handleRegisterModalSubmit(interaction);
      }
    }
  });

  // Event: Message Creation (AI assistant mentions)
  client.on('messageCreate', async (message: Message) => {
    if (message.author.bot) return;

    const botUser = client.user;
    if (botUser && message.mentions.has(botUser)) {
      // Remove bot mention from content
      const mentionRegex = new RegExp(`<@!?${botUser.id}>`, 'g');
      const question = message.content.replace(mentionRegex, '').trim();

      if (!question) {
        await message.reply({
          content: 'Hello! I am HackerHelp, your AI support and hackathon operations companion. Ask me anything about the event rules, timeline, tracks, or sponsors, or use `/help` to see commands.',
          allowedMentions: { repliedUser: true }
        });
        return;
      }

      // Indicate typing while query processing
      if ('sendTyping' in message.channel) {
        await message.channel.sendTyping();
      }

      try {
        logger.info(`Answering mention query from ${message.author.username}: "${question.substring(0, 50)}..."`);
        const answer = await askDocMindRAG([
          {
            role: 'system',
            content: 'You are HackerHelp, a Discord-native AI support and hackathon operations assistant. Answer questions grounded in the loaded docs. Keep replies succinct.'
          },
          {
            role: 'user',
            content: question
          }
        ]);

        await message.reply({
          content: answer.length > 2000 ? `${answer.slice(0, 1997)}...` : answer,
          allowedMentions: { repliedUser: true }
        });
      } catch (error) {
        logger.error('Failed to answer mention message:', error);
        await message.reply({
          content: 'Sorry, I had trouble reaching the AI assistant database. Please try again later.',
          allowedMentions: { repliedUser: true }
        });
      }
    }
  });

  try {
    await client.login(token);
  } catch (error) {
    logger.error('Failed to login bot to Discord client:', error);
  }
}
