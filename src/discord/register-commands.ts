import { REST, Routes } from 'discord.js';
import { commandsDefinitions } from './command-definitions';
import dotenv from 'dotenv';
import { logger } from '../logger';

dotenv.config();

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId) {
  logger.error('Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in environmental configurations.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    logger.info(`Started refreshing ${commandsDefinitions.length} application (/) commands.`);

    if (guildId) {
      // Local registration for quick testing
      await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commandsDefinitions }
      );
      logger.info(`Successfully reloaded application (/) commands inside Guild ${guildId}.`);
    } else {
      // Global registration
      await rest.put(
        Routes.applicationCommands(clientId),
        { body: commandsDefinitions }
      );
      logger.info('Successfully reloaded application (/) commands globally.');
    }
  } catch (error) {
    logger.error('Failed to register application slash commands:', error);
    process.exitCode = 1;
  }
})();
