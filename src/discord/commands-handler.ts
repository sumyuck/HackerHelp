import { 
  ChatInputCommandInteraction, 
  EmbedBuilder, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  ActionRowBuilder, 
  ModalSubmitInteraction,
  ChannelType
} from 'discord.js';
import { Types } from 'mongoose';
import * as userService from '../services/user.service';
import * as hackathonService from '../services/hackathon.service';
import * as teamService from '../services/team.service';
import * as submissionService from '../services/submission.service';
import * as judgeService from '../services/judge.service';
import * as knowledgeService from '../services/knowledge.service';
import { answerQuestion } from '../services/answer.service';
import { composeText } from '../services/openai.service';
import { buildAnswerEmbed } from './answer-presenter';
import { Hackathon, Track, Team, Registration, Submission, User, GlobalRole, JudgeEvaluation } from '../database/models';
import { logger } from '../logger';

/**
 * Main entrance router for all slash command interactions.
 */
export async function handleSlashCommandInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
  const { commandName, options, user, guildId } = interaction;
  
  // Ensure user has a profile in MongoDB
  await userService.getOrCreateUser(user.id, user.username);

  try {
    switch (commandName) {
      case 'auth':
        await handleAuth(interaction);
        break;
      case 'register':
        await handleRegisterRequest(interaction);
        break;
      case 'profile':
        await handleProfile(interaction);
        break;
      case 'help':
        await handleHelp(interaction);
        break;
      case 'ask':
        await handleAsk(interaction);
        break;
      case 'track':
        await handleTrackCommands(interaction);
        break;
      case 'hackathon':
        await handleHackathonCommands(interaction);
        break;
      case 'team':
        await handleTeamCommands(interaction);
        break;
      case 'submission':
        await handleSubmissionCommands(interaction);
        break;
      case 'announcement':
        await handleAnnouncement(interaction);
        break;
      case 'index':
        await handleIndexCommands(interaction);
        break;
      case 'judge':
        await handleJudgeCommands(interaction);
        break;
      case 'admin':
        await handleAdminCommands(interaction);
        break;
      default:
        await interaction.reply({ content: 'Unknown command.', ephemeral: true });
    }
  } catch (error: any) {
    logger.error(`Error executing command ${commandName}:`, error);
    const errorEmbed = new EmbedBuilder()
      .setColor('#FF0055')
      .setTitle('Command Execution Error')
      .setDescription(error.message || 'An unexpected error occurred while executing the command.');
    
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
  }
}

/**
 * Command: /auth
 */
async function handleAuth(interaction: ChatInputCommandInteraction): Promise<void> {
  const roles = await userService.getUserRoles(interaction.user.id);
  
  const embed = new EmbedBuilder()
    .setColor('#00FFAA')
    .setTitle('HackerHelp - Sync Confirmed')
    .setDescription(`Welcome **${interaction.user.username}**! Your Discord account has been successfully synchronized with HackerHelp.`)
    .addFields(
      { name: 'Your Roles', value: roles.map(r => `\`${r.toUpperCase()}\``).join(', '), inline: true },
      { name: 'Discord ID', value: `\`${interaction.user.id}\``, inline: true }
    )
    .setFooter({ text: 'HackerHelp | Grounded AI Companion' });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/**
 * Command: /register
 */
async function handleRegisterRequest(interaction: ChatInputCommandInteraction): Promise<void> {
  // Check if a hackathon with registrations open exists
  const activeHackathon = await Hackathon.findOne({ status: 'Registration Open' });
  if (!activeHackathon) {
    await interaction.reply({
      content: 'There is no active hackathon accepting registrations right now.',
      ephemeral: true
    });
    return;
  }

  // Check if user is already registered for this hackathon
  const existing = await Registration.findOne({ userId: interaction.user.id, hackathonId: activeHackathon._id });
  if (existing) {
    await interaction.reply({
      content: `You have already registered for **${activeHackathon.name}**! Run \`/profile\` to view your details.`,
      ephemeral: true
    });
    return;
  }

  // Create Registration Modal
  const modal = new ModalBuilder()
    .setCustomId('register_modal')
    .setTitle(`Register: ${activeHackathon.name}`);

  const nameInput = new TextInputBuilder()
    .setCustomId('fullName')
    .setLabel('Full Name')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('John Doe');

  const collegeEmailInput = new TextInputBuilder()
    .setCustomId('collegeEmail')
    .setLabel('College | Email (Separated by |)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('Stanford University | john@example.com');

  const linksInput = new TextInputBuilder()
    .setCustomId('links')
    .setLabel('GitHub | LinkedIn URLs (Separated by |)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('github.com/username | linkedin.com/in/username');

  const skillsInput = new TextInputBuilder()
    .setCustomId('skillsExperience')
    .setLabel('Skills | Experience (Separated by |)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setPlaceholder('React, TypeScript, Python | Intermediate (1 year)');

  const trackInput = new TextInputBuilder()
    .setCustomId('preferredTrack')
    .setLabel('Preferred Track Title')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('AI or Blockchain or Cybersecurity');

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(collegeEmailInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(linksInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(skillsInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(trackInput)
  );

  await interaction.showModal(modal);
}

/**
 * Modal submit handler for registration
 */
export async function handleRegisterModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const activeHackathon = await Hackathon.findOne({ status: 'Registration Open' });
  if (!activeHackathon) {
    await interaction.editReply({ content: 'Registration is no longer open.' });
    return;
  }

  const fullName = interaction.fields.getTextInputValue('fullName');
  const collegeEmail = interaction.fields.getTextInputValue('collegeEmail');
  const links = interaction.fields.getTextInputValue('links');
  const skillsExperience = interaction.fields.getTextInputValue('skillsExperience');
  const preferredTrackName = interaction.fields.getTextInputValue('preferredTrack');

  // Split inputs
  const [collegeRaw = '', emailRaw = ''] = collegeEmail.split('|');
  const [githubRaw = '', linkedinRaw = ''] = links.split('|');
  const [skillsRaw = '', experienceRaw = ''] = skillsExperience.split('|');

  const college = collegeRaw.trim();
  const email = emailRaw.trim();
  const github = githubRaw.trim();
  const linkedin = linkedinRaw.trim();
  const skills = skillsRaw.split(',').map(s => s.trim()).filter(Boolean);
  const experience = experienceRaw.trim();

  // Validate format
  if (!email || !github) {
    await interaction.editReply({
      content: 'Invalid formats. Please make sure to separate inputs with a pipe `|` character.'
    });
    return;
  }

  // Find preferred track if it exists
  const track = await Track.findOne({
    hackathonId: activeHackathon._id,
    title: { $regex: new RegExp(`^${preferredTrackName.trim()}$`, 'i') }
  });

  try {
    await hackathonService.registerParticipant(interaction.user.id, activeHackathon._id.toString(), {
      fullName,
      college,
      email,
      github,
      linkedin,
      skills,
      experience,
      preferredTrackId: track?._id.toString()
    });

    const successEmbed = new EmbedBuilder()
      .setColor('#00FFAA')
      .setTitle('Registration Confirmed!')
      .setDescription(`Thank you, **${fullName}**! You are now registered for **${activeHackathon.name}**.`)
      .addFields(
        { name: 'College', value: college, inline: true },
        { name: 'Track Option', value: track ? track.title : `"${preferredTrackName}" (Temporary/Unregistered)`, inline: true }
      )
      .setFooter({ text: 'Run /team create to start forming a project squad!' });

    await interaction.editReply({ embeds: [successEmbed] });
  } catch (error: any) {
    await interaction.editReply({ content: `Registration failed: ${error.message}` });
  }
}

/**
 * Command: /profile
 */
async function handleProfile(interaction: ChatInputCommandInteraction): Promise<void> {
  const reg = await Registration.findOne({ userId: interaction.user.id }).populate('hackathonId').populate('preferredTrackId');
  
  if (!reg) {
    await interaction.reply({
      content: 'You have not registered for any hackathons yet! Use `/register` to register for the active hackathon.',
      ephemeral: true
    });
    return;
  }

  const hackathon = reg.hackathonId as any;
  const track = reg.preferredTrackId as any;
  const team = await Team.findOne({ hackathonId: hackathon._id, members: interaction.user.id });

  const embed = new EmbedBuilder()
    .setColor('#00AAFF')
    .setTitle(`${reg.fullName}'s HackerHelp Profile`)
    .setDescription(`Profile details for **${hackathon.name}**`)
    .addFields(
      { name: 'Email', value: reg.email, inline: true },
      { name: 'College', value: reg.college, inline: true },
      { name: 'Preferred Track', value: track ? track.title : 'None selected', inline: true },
      { name: 'GitHub', value: `[Link](${reg.github})`, inline: true },
      { name: 'LinkedIn', value: `[Link](${reg.linkedin})`, inline: true },
      { name: 'Team status', value: team ? `**${team.name}** (${team.members.length} members)` : 'No Team', inline: true },
      { name: 'Skills', value: reg.skills.join(', ') || 'None specified' },
      { name: 'Experience', value: reg.experience }
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/**
 * Command: /help
 */
async function handleHelp(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor('#8A2BE2')
    .setTitle('HackerHelp - Help Desk')
    .setDescription('List of available slash commands for organizing and participating in hackathons:')
    .addFields(
      { name: 'Participant Commands', value: '`/auth` - Sync your account\n`/register` - Complete hackathon signup modal\n`/profile` - View your participant card\n`/ask` - Ask about Orchestrate (answers cite their sources)' },
      { name: 'Team Commands', value: '`/team create [name] [track_id]` - Form a team\n`/team invite [@user]` - Send team invite\n`/team info` - View your team\n`/team leave` - Leave current team\n`/team delete` - Disband team (Leader)' },
      { name: 'Submission Commands', value: '`/submission create` - Submit project draft\n`/submission update` - Submit a new version\n`/submission status` - View submit logs\n`/submission history` - View past versions' },
      { name: 'Info Commands', value: '`/hackathon list` - List hackathons\n`/track list` - List tracks' },
      { name: 'Judge & Admin Commands', value: '`/judge dashboard` - Score panel\n`/admin analytics` - Hackathon metrics\n`/admin settings` - Modify hackathon status\n`/admin roles` - Adjust users permissions' }
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/**
 * Command: /ask
 */
async function handleAsk(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const question = interaction.options.getString('question', true);

  const result = await answerQuestion(question);
  await interaction.editReply({ embeds: [buildAnswerEmbed(result, question)] });
}

/**
 * Subcommand Handler: /track
 */
async function handleTrackCommands(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'list') {
    const tracks = await Track.find().populate('hackathonId');
    if (tracks.length === 0) {
      await interaction.reply({ content: 'No tracks registered in the database.', ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor('#FF9900')
      .setTitle('Registered Hackathon Tracks');

    tracks.forEach(track => {
      const hackathon = track.hackathonId as any;
      embed.addFields({
        name: `${track.title} (Hackathon: ${hackathon.name})`,
        value: `**ID:** \`${track._id}\`\n**Description:** ${track.description || 'No description.'}`
      });
    });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  } 
  else if (subcommand === 'info') {
    const trackId = interaction.options.getString('track_id', true);
    if (!Types.ObjectId.isValid(trackId)) {
      await interaction.reply({ content: 'Invalid Track ID format.', ephemeral: true });
      return;
    }

    const track = await Track.findById(new Types.ObjectId(trackId)).populate('hackathonId');
    if (!track) {
      await interaction.reply({ content: 'Track not found.', ephemeral: true });
      return;
    }

    const hackathon = track.hackathonId as any;
    const embed = new EmbedBuilder()
      .setColor('#FF9900')
      .setTitle(`Track Info: ${track.title}`)
      .addFields(
        { name: 'Track ID', value: `\`${track._id}\`` },
        { name: 'Hackathon', value: hackathon.name },
        { name: 'Description', value: track.description || 'None' },
        { name: 'Judges Count', value: track.judges.length.toString(), inline: true },
        { name: 'Mentors Count', value: track.mentors.length.toString(), inline: true },
        { name: 'Max Teams Limit', value: track.maxTeams ? track.maxTeams.toString() : 'Unlimited', inline: true }
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

/**
 * Subcommand Handler: /hackathon
 */
async function handleHackathonCommands(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'list') {
    const hackathons = await Hackathon.find();
    if (hackathons.length === 0) {
      await interaction.reply({ content: 'No hackathons registered in the database.', ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor('#00FF66')
      .setTitle('HackerHelp Hackathons List');

    hackathons.forEach(h => {
      embed.addFields({
        name: `${h.name} [\`${h.status}\`]`,
        value: `**ID:** \`${h._id}\`\n**Dates:** ${h.startDate.toDateString()} to ${h.endDate.toDateString()}`
      });
    });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  } 
  else if (subcommand === 'info') {
    const hackathonId = interaction.options.getString('hackathon_id', true);
    if (!Types.ObjectId.isValid(hackathonId)) {
      await interaction.reply({ content: 'Invalid Hackathon ID format.', ephemeral: true });
      return;
    }

    const h = await Hackathon.findById(new Types.ObjectId(hackathonId));
    if (!h) {
      await interaction.reply({ content: 'Hackathon not found.', ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor('#00FF66')
      .setTitle(h.name)
      .setDescription(h.description || 'No description.')
      .addFields(
        { name: 'Status', value: `\`${h.status}\``, inline: true },
        { name: 'Hackathon ID', value: `\`${h._id}\``, inline: true },
        { name: 'Registration End', value: h.registrationEnd.toDateString(), inline: true },
        { name: 'Submission End', value: h.submissionEnd.toDateString(), inline: true },
        { name: 'Judging End', value: h.judgingEnd.toDateString(), inline: true },
        { name: 'Winner Announcement', value: h.resultDate.toDateString(), inline: true }
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

/**
 * Subcommand Handler: /team
 */
async function handleTeamCommands(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  const discordId = interaction.user.id;

  if (subcommand === 'create') {
    const name = interaction.options.getString('name', true);
    const trackId = interaction.options.getString('track_id', true);

    if (!Types.ObjectId.isValid(trackId)) {
      await interaction.reply({ content: 'Invalid Track ID.', ephemeral: true });
      return;
    }

    // Check if track exists
    const track = await Track.findById(new Types.ObjectId(trackId));
    if (!track) {
      await interaction.reply({ content: 'Track not found.', ephemeral: true });
      return;
    }

    const team = await teamService.createTeam(discordId, track.hackathonId.toString(), trackId, name);

    const embed = new EmbedBuilder()
      .setColor('#FF00AA')
      .setTitle('Team Created!')
      .setDescription(`Your team **${team.name}** has been registered for track **${track.title}**!`)
      .addFields(
        { name: 'Team ID', value: `\`${team._id}\`` },
        { name: 'Leader', value: `<@${discordId}>` }
      );

    await interaction.reply({ embeds: [embed] });
  } 
  else if (subcommand === 'invite') {
    const targetUser = interaction.options.getUser('user', true);
    
    // Find inviter's team
    const team = await Team.findOne({ members: discordId });
    if (!team) {
      await interaction.reply({ content: 'You are not in any team. Create one first with `/team create`.', ephemeral: true });
      return;
    }

    await teamService.inviteToTeam(discordId, targetUser.id, team._id.toString());
    
    // Send invitation reply
    const embed = new EmbedBuilder()
      .setColor('#FF00AA')
      .setTitle('Team Invitation Sent!')
      .setDescription(`<@${discordId}> invited <@${targetUser.id}> to join team **${team.name}**.`);
      
    await interaction.reply({ embeds: [embed] });

    // Send DM invitation card to invitee if possible
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor('#FF00AA')
        .setTitle('HackerHelp Team Invite')
        .setDescription(`You have been invited to join team **${team.name}**!`)
        .setFooter({ text: 'To accept, contact the team leader or type in server.' });
        
      await targetUser.send({ embeds: [dmEmbed] });
    } catch {
      logger.info(`Failed to send DM invite to ${targetUser.username}`);
    }
  } 
  else if (subcommand === 'info') {
    const team = await Team.findOne({ members: discordId }).populate('trackId').populate('hackathonId');
    if (!team) {
      await interaction.reply({ content: 'You are not on a team.', ephemeral: true });
      return;
    }

    const track = team.trackId as any;
    const hackathon = team.hackathonId as any;

    const embed = new EmbedBuilder()
      .setColor('#FF00AA')
      .setTitle(`Team Info: ${team.name}`)
      .addFields(
        { name: 'Hackathon', value: hackathon.name },
        { name: 'Track', value: track.title },
        { name: 'Leader', value: `<@${team.leaderId}>` },
        { name: 'Members', value: team.members.map(m => `<@${m}>`).join(', ') }
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
  } 
  else if (subcommand === 'leave') {
    const team = await Team.findOne({ members: discordId });
    if (!team) {
      await interaction.reply({ content: 'You are not on a team.', ephemeral: true });
      return;
    }

    await teamService.leaveTeam(discordId, team._id.toString());
    await interaction.reply({ content: `You have successfully left team **${team.name}**.`, ephemeral: true });
  } 
  else if (subcommand === 'edit') {
    const name = interaction.options.getString('name');
    const trackId = interaction.options.getString('track_id');

    const team = await Team.findOne({ leaderId: discordId });
    if (!team) {
      await interaction.reply({ content: 'Only the team leader can edit team properties.', ephemeral: true });
      return;
    }

    if (name) team.name = name;
    if (trackId) {
      if (!Types.ObjectId.isValid(trackId)) {
        await interaction.reply({ content: 'Invalid track ID.', ephemeral: true });
        return;
      }
      team.trackId = new Types.ObjectId(trackId);
    }
    await team.save();

    await interaction.reply({ content: 'Team profile updated successfully!', ephemeral: true });
  } 
  else if (subcommand === 'delete') {
    const team = await Team.findOne({ leaderId: discordId });
    if (!team) {
      await interaction.reply({ content: 'Only the team leader can delete/disband the team.', ephemeral: true });
      return;
    }

    await teamService.deleteTeam(discordId, team._id.toString());
    await interaction.reply({ content: `Team **${team.name}** has been successfully disbanded.` });
  }
}

/**
 * Subcommand Handler: /submission
 */
async function handleSubmissionCommands(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  const discordId = interaction.user.id;

  // Find team
  const team = await Team.findOne({ members: discordId });
  if (!team) {
    await interaction.reply({ content: 'You must be on a team to submit projects.', ephemeral: true });
    return;
  }

  if (subcommand === 'create') {
    const projectName = interaction.options.getString('project_name', true);
    const problem = interaction.options.getString('problem', true);
    const solution = interaction.options.getString('solution', true);
    const techStack = interaction.options.getString('tech_stack', true).split(',').map(s => s.trim());
    const github = interaction.options.getString('github', true);
    
    const architecture = interaction.options.getString('architecture') || undefined;
    const innovation = interaction.options.getString('innovation') || undefined;
    const demo = interaction.options.getString('demo') || undefined;
    const presentation = interaction.options.getString('presentation') || undefined;
    const notes = interaction.options.getString('notes') || undefined;

    const submission = await submissionService.submitProject(discordId, team._id.toString(), {
      projectName,
      problemStatement: problem,
      solution,
      techStack,
      githubLink: github,
      architectureDescription: architecture,
      innovationPoints: innovation,
      demoLink: demo,
      presentationLink: presentation,
      additionalNotes: notes
    });

    const embed = new EmbedBuilder()
      .setColor('#00FFFF')
      .setTitle('Project Submitted Successfully!')
      .setDescription(`Your project **${projectName}** (Version 1) has been locked in.`)
      .addFields(
        { name: 'Submission ID', value: `\`${submission._id}\`` },
        { name: 'GitHub Repo', value: github }
      );

    await interaction.reply({ embeds: [embed] });
  } 
  else if (subcommand === 'update') {
    const submission = await Submission.findOne({ teamId: team._id });
    if (!submission) {
      await interaction.reply({ content: 'You have not submitted a project yet! Use `/submission create` first.', ephemeral: true });
      return;
    }

    const projectName = interaction.options.getString('project_name') || submission.projectName;
    const problem = interaction.options.getString('problem') || submission.problemStatement;
    const solution = interaction.options.getString('solution') || submission.solution;
    const techStack = interaction.options.getString('tech_stack') ? 
      interaction.options.getString('tech_stack')!.split(',').map(s => s.trim()) : 
      submission.techStack;
    const github = interaction.options.getString('github') || submission.githubLink;
    
    const architecture = interaction.options.getString('architecture') || submission.architectureDescription;
    const innovation = interaction.options.getString('innovation') || submission.innovationPoints;
    const demo = interaction.options.getString('demo') || submission.demoLink;
    const presentation = interaction.options.getString('presentation') || submission.presentationLink;
    const notes = interaction.options.getString('notes') || submission.additionalNotes;

    const updated = await submissionService.submitProject(discordId, team._id.toString(), {
      projectName,
      problemStatement: problem,
      solution,
      techStack,
      githubLink: github,
      architectureDescription: architecture,
      innovationPoints: innovation,
      demoLink: demo,
      presentationLink: presentation,
      additionalNotes: notes
    });

    const embed = new EmbedBuilder()
      .setColor('#00FFFF')
      .setTitle('Project Updated!')
      .setDescription(`Your submission **${projectName}** has been updated to **Version ${updated.currentVersion}**.`);

    await interaction.reply({ embeds: [embed] });
  } 
  else if (subcommand === 'status') {
    const submission = await Submission.findOne({ teamId: team._id }).populate('hackathonId');
    if (!submission) {
      await interaction.reply({ content: 'No submission found for your team.', ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor('#00FFFF')
      .setTitle(`Project Submission Card: ${submission.projectName}`)
      .addFields(
        { name: 'Current Version', value: `Version ${submission.currentVersion}`, inline: true },
        { name: 'GitHub Link', value: submission.githubLink, inline: true },
        { name: 'Demo Link', value: submission.demoLink || 'Not provided', inline: true },
        { name: 'Solution Overview', value: submission.solution.substring(0, 500) }
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
  } 
  else if (subcommand === 'history') {
    const submission = await Submission.findOne({ teamId: team._id });
    if (!submission) {
      await interaction.reply({ content: 'No submission found.', ephemeral: true });
      return;
    }

    const versions = await submissionService.getSubmissionHistory(submission._id.toString());
    const embed = new EmbedBuilder()
      .setColor('#00FFFF')
      .setTitle(`Version History: ${submission.projectName}`);

    versions.forEach(v => {
      embed.addFields({
        name: `Version ${v.version} (${new Date(v.createdAt).toLocaleString()})`,
        value: `**Submitted by:** <@${v.createdById}>\n**Tech:** ${v.techStack.join(', ')}`
      });
    });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

/**
 * Command: /announcement
 */
async function handleAnnouncement(interaction: ChatInputCommandInteraction): Promise<void> {
  const actorId = interaction.user.id;
  
  // Verify Admin role
  const isAdmin = await userService.hasRole(actorId, ['super_admin', 'event_admin']);
  if (!isAdmin) {
    await interaction.reply({ content: 'You must be a Super Admin or Event Admin to construct announcements.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const hackathonId = interaction.options.getString('hackathon_id', true);
  const title = interaction.options.getString('title', true);
  const draftContent = interaction.options.getString('draft_content', true);

  if (!Types.ObjectId.isValid(hackathonId)) {
    await interaction.editReply({ content: 'Invalid Hackathon ID.' });
    return;
  }

  // Drafting is free-form generation, not a factual answer, so it bypasses the grounded answer pipeline.
  const prompt = `
Generate three variations of the following announcement draft:

Title: ${title}
Draft: ${draftContent}

1. **Professional Email Version**: Business-centric, clear and formal formatting.
2. **Discord Post Version**: Uses Markdown, emojis, clear calls to action, and bold text suited for discord chat.
3. **Short/SMS/Notification Version**: 2-sentence summary.
  `;

  const response = await composeText(
    'You are an expert copywriter and communications officer. Format documents beautifully with markdown. Do not add facts (dates, prizes, links) that are not in the draft.',
    prompt
  );

  const embed = new EmbedBuilder()
    .setColor('#F75D59')
    .setTitle(`Announcement Composer: ${title}`)
    .setDescription(response.substring(0, 4000));

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Subcommand Handler: /index
 */
async function handleIndexCommands(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  const actorId = interaction.user.id;

  if (subcommand === 'pdf') {
    const embed = new EmbedBuilder()
      .setColor('#7D0552')
      .setTitle('HackerHelp - File Indexing')
      .setDescription('To index lightweight files (PDF, DOCX, TXT, MD) into the Supabase database:')
      .addFields(
        { name: '1. Access Dashboard', value: 'Use the backend dashboard upload page or make an HTTP POST request.' },
        { name: '2. API Details', value: 'Send multipart form-data to `POST /api/documents/upload` with an `Authorization: Bearer <ADMIN_API_TOKEN>` header and a `file` field. Re-uploading a file with the same name replaces its previous version.' },
        { name: 'Knowledge base', value: 'Curated docs live in the repository under `knowledge/` and are synced with `npm run kb:ingest`.' }
      )
      .setFooter({ text: 'All file processing converts documents to markdown sections and updates vectors automatically.' });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  } 
  else if (subcommand === 'channel') {
    // Requires Admin access
    const isAdmin = await userService.hasRole(actorId, ['super_admin', 'event_admin']);
    if (!isAdmin) {
      await interaction.reply({ content: 'Only Event Admins and Super Admins can index channel histories.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const channelInput = interaction.options.getChannel('channel', true);

    if (channelInput.type !== ChannelType.GuildText) {
      await interaction.editReply({ content: 'Only standard Text channels can be indexed.' });
      return;
    }

    try {
      // Fetch channel messages (last 100 messages)
      const channel = await interaction.guild?.channels.fetch(channelInput.id);
      if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.editReply({ content: 'Failed to access the selected channel.' });
        return;
      }

      const messages = await channel.messages.fetch({ limit: 100 });
      let mdArchive = `# Channel Log Archive: #${channel.name}\n`;
      mdArchive += `*Indexed at: ${new Date().toLocaleString()} by <@${actorId}>*\n\n`;

      const sorted = Array.from(messages.values()).reverse();
      sorted.forEach(msg => {
        if (msg.content) {
          const timestamp = msg.createdAt.toLocaleString();
          mdArchive += `### **${msg.author.username}** at *${timestamp}*\n`;
          mdArchive += `${msg.content}\n\n`;
        }
      });

      // One document per channel: re-indexing replaces the previous archive instead of piling up copies.
      // Member messages are not verified facts, so the archive is labelled "community".
      const slug = `discord/${channel.id}`;
      const sections = await knowledgeService.indexDocument({
        slug,
        title: `#${channel.name} channel archive`,
        body: mdArchive,
        sourceUrl: null,
        origin: 'discord_channel',
        verification: 'community'
      });

      await userService.logAction(actorId, 'index_channel_messages', 'Channel', channel.id, { slug, sections });

      await interaction.editReply({
        content: `Indexed the last ${sorted.length} messages from <#${channel.id}> (${sections} sections). Re-running this replaces the previous archive.`
      });
    } catch (err: any) {
      logger.error('Channel indexing failed:', err);
      await interaction.editReply({ content: 'Indexing failed. Check the bot logs for details.' });
    }
  } 
  else if (subcommand === 'reindex') {
    await interaction.reply({ content: 'Run `npm run kb:ingest` on the server to sync the curated knowledge base. It re-embeds only documents that changed. Uploaded files are re-indexed by uploading them again.', ephemeral: true });
  }
}

/**
 * Subcommand Handler: /judge
 */
async function handleJudgeCommands(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  const actorId = interaction.user.id;

  // Validate Judge / Admin Role
  const isJudge = await userService.hasRole(actorId, ['super_admin', 'track_admin', 'judge']);
  if (!isJudge) {
    await interaction.reply({ content: 'Only assigned judges and track admins can access the judging panel.', ephemeral: true });
    return;
  }

  if (subcommand === 'dashboard') {
    const submissions = await judgeService.getAssignedSubmissions(actorId);
    if (submissions.length === 0) {
      await interaction.reply({ content: 'There are no submissions currently assigned to your tracks.', ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor('#E2F516')
      .setTitle('Assigned Projects Review Panel')
      .setDescription('Use `/judge review` to score these submissions:');

    submissions.forEach(sub => {
      const team = sub.teamId as any;
      embed.addFields({
        name: `${sub.projectName} (Team: ${team.name})`,
        value: `**ID:** \`${sub._id}\`\n**GitHub:** ${sub.githubLink}\n**Version:** V${sub.currentVersion}`
      });
    });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  } 
  else if (subcommand === 'review') {
    const subId = interaction.options.getString('submission_id', true);
    if (!Types.ObjectId.isValid(subId)) {
      await interaction.reply({ content: 'Invalid submission ID.', ephemeral: true });
      return;
    }

    const innovation = interaction.options.getInteger('innovation', true);
    const complexity = interaction.options.getInteger('complexity', true);
    const implementation = interaction.options.getInteger('implementation', true);
    const scalability = interaction.options.getInteger('scalability', true);
    const presentation = interaction.options.getInteger('presentation', true);
    const businessValue = interaction.options.getInteger('business_value', true);
    const ux = interaction.options.getInteger('ux', true);
    const impact = interaction.options.getInteger('impact', true);
    const comment = interaction.options.getString('comment') || undefined;

    await interaction.deferReply({ ephemeral: true });

    try {
      // Evaluate and score
      const evaluation = await judgeService.scoreSubmission(actorId, subId, {
        innovation,
        technicalComplexity: complexity,
        implementation,
        scalability,
        presentation,
        businessValue,
        ux,
        impact
      }, comment);

      // Trigger background AI summary generation to help judges
      const aiSummary = await judgeService.generateProjectSummary(actorId, subId);

      const embed = new EmbedBuilder()
        .setColor('#E2F516')
        .setTitle('Evaluation Score Recorded!')
        .setDescription(`Weighted score: **${evaluation.weightedScore} / 10**`)
        .addFields(
          { name: 'AI Grounded Analysis Report', value: aiSummary.substring(0, 1020) }
        );
        
      if (aiSummary.length > 1020) {
        embed.addFields({ name: 'AI Analysis Report (Cont.)', value: aiSummary.substring(1020, 2040) });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (err: any) {
      await interaction.editReply({ content: `Scoring failed: ${err.message}` });
    }
  }
}

/**
 * Subcommand Handler: /admin
 */
async function handleAdminCommands(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  const actorId = interaction.user.id;

  // Validate Admin/Super Admin
  const isSuper = await userService.hasRole(actorId, ['super_admin']);
  const isEvent = await userService.hasRole(actorId, ['super_admin', 'event_admin']);

  if (subcommand === 'analytics') {
    if (!isEvent) {
      await interaction.reply({ content: 'Only event admins can view high-level analytics.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      // Aggregate stats
      const totalUsers = await User.countDocuments();
      const registrations = await Registration.countDocuments();
      const teams = await Team.countDocuments();
      const subs = await Submission.countDocuments();
      const evaluations = await JudgeEvaluation.countDocuments();

      let completionRate = 0;
      if (teams > 0) {
        completionRate = parseFloat(((subs / teams) * 100).toFixed(2));
      }

      const embed = new EmbedBuilder()
        .setColor('#E5E4E2')
        .setTitle('HackerHelp - Hackathon Analytics')
        .addFields(
          { name: 'Total Users Synced', value: totalUsers.toString(), inline: true },
          { name: 'Total Registrations', value: registrations.toString(), inline: true },
          { name: 'Total Teams formed', value: teams.toString(), inline: true },
          { name: 'Projects Submitted', value: subs.toString(), inline: true },
          { name: 'Submission Completion Rate', value: `${completionRate}%`, inline: true },
          { name: 'Total Judge Evaluations', value: evaluations.toString(), inline: true }
        )
        .setFooter({ text: 'Access /api/analytics endpoint for granular details.' });

      await interaction.editReply({ embeds: [embed] });
    } catch (err: any) {
      await interaction.editReply({ content: `Failed to compile analytics: ${err.message}` });
    }
  } 
  else if (subcommand === 'settings') {
    if (!isSuper) {
      await interaction.reply({ content: 'Only Super Admins can adjust global settings/statuses.', ephemeral: true });
      return;
    }

    const hackathonId = interaction.options.getString('hackathon_id', true);
    const status = interaction.options.getString('status', true);

    if (!Types.ObjectId.isValid(hackathonId)) {
      await interaction.reply({ content: 'Invalid hackathon ID format.', ephemeral: true });
      return;
    }

    try {
      await hackathonService.updateHackathonStatus(actorId, hackathonId, status as any);
      await interaction.reply({ content: `Status of hackathon \`${hackathonId}\` has been set to **${status}**.` });
    } catch (err: any) {
      await interaction.reply({ content: `Settings update failed: ${err.message}`, ephemeral: true });
    }
  } 
  else if (subcommand === 'roles') {
    if (!isSuper) {
      await interaction.reply({ content: 'Only Super Admins can adjust user permissions/roles.', ephemeral: true });
      return;
    }

    const targetUser = interaction.options.getUser('user', true);
    const action = interaction.options.getString('action', true);
    const role = interaction.options.getString('role', true) as GlobalRole;

    try {
      // Ensure target user is recorded in MongoDB first
      await userService.getOrCreateUser(targetUser.id, targetUser.username);

      if (action === 'grant') {
        await userService.assignUserRole(actorId, targetUser.id, role);
        await interaction.reply({ content: `Successfully granted **${role.toUpperCase()}** permission to <@${targetUser.id}>.` });
      } else {
        await userService.removeUserRole(actorId, targetUser.id, role);
        await interaction.reply({ content: `Successfully revoked **${role.toUpperCase()}** permission from <@${targetUser.id}>.` });
      }
    } catch (err: any) {
      await interaction.reply({ content: `Role assignment failed: ${err.message}`, ephemeral: true });
    }
  }
}
