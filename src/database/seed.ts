import 'dotenv/config';
import { connectDatabase } from './connection';
import { Hackathon, Track } from './models';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()]
});

async function seed() {
  await connectDatabase();

  if (await Hackathon.exists({})) {
    logger.info('Hackathons already exist; skipping sample seed to preserve data.');
    process.exit(0);
  }

  const guildId = process.env.DISCORD_GUILD_ID || '123456789012345678';

  const today = new Date();
  const nextMonth = new Date();
  nextMonth.setMonth(today.getMonth() + 1);

  logger.info('Creating default active Hackathon...');
  const hackathon = await Hackathon.create({
    name: 'HackerHelp Global AI Hackathon',
    description: 'The premier hackathon for agentic AI and next-gen developer tools.',
    startDate: today,
    endDate: nextMonth,
    registrationStart: today,
    registrationEnd: nextMonth,
    submissionStart: today,
    submissionEnd: nextMonth,
    judgingStart: today,
    judgingEnd: nextMonth,
    resultDate: nextMonth,
    discordServerId: guildId,
    status: 'Registration Open',
    organizers: []
  });

  logger.info(`Hackathon created successfully! ID: ${hackathon._id}`);

  logger.info('Creating tracks...');
  const track1 = await Track.create({
    hackathonId: hackathon._id,
    title: 'Advanced Agentic Coding',
    description: 'Build autonomous agents that write, test, debug, or deploy code.',
    judges: [],
    mentors: [],
    admins: []
  });

  const track2 = await Track.create({
    hackathonId: hackathon._id,
    title: 'General AI & RAG Apps',
    description: 'Build applications leveraging retrieval augmented generation and large language models.',
    judges: [],
    mentors: [],
    admins: []
  });

  const track3 = await Track.create({
    hackathonId: hackathon._id,
    title: 'Web3 & Decentralized Apps',
    description: 'Integrate decentralized technologies with agentic workflows.',
    judges: [],
    mentors: [],
    admins: []
  });

  logger.info(`Tracks created successfully!
  - ${track1.title} (ID: ${track1._id})
  - ${track2.title} (ID: ${track2._id})
  - ${track3.title} (ID: ${track3._id})
  `);

  logger.info('Database seeding completed successfully.');
  process.exit(0);
}

seed().catch(err => {
  logger.error('Seeding failed:', err);
  process.exit(1);
});
