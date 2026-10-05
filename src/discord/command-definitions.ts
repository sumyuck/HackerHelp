import { SlashCommandBuilder } from 'discord.js';

export const commandsDefinitions = [
  // /ticket
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Support tickets handled by the moderators')
    .addSubcommand(sub => sub
      .setName('open')
      .setDescription('Ask for help from the team (HackerHelp checks the docs first)')
      .addStringOption(o => o.setName('issue').setDescription('Describe the problem. No personal or payment details.').setRequired(true).setMaxLength(1500)))
    .addSubcommand(sub => sub
      .setName('status')
      .setDescription('Show your open tickets, or one ticket')
      .addIntegerOption(o => o.setName('number').setDescription('Ticket number').setMinValue(1)))
    .addSubcommand(sub => sub
      .setName('assign')
      .setDescription('Moderators: assign a ticket')
      .addIntegerOption(o => o.setName('number').setDescription('Ticket number (omit inside the ticket thread)').setMinValue(1))
      .addUserOption(o => o.setName('user').setDescription('Assignee (defaults to you)')))
    .addSubcommand(sub => sub
      .setName('waiting')
      .setDescription('Moderators: mark a ticket as waiting on the participant')
      .addStringOption(o => o.setName('note').setDescription('What you need from them').setRequired(true).setMaxLength(1000))
      .addIntegerOption(o => o.setName('number').setDescription('Ticket number (omit inside the ticket thread)').setMinValue(1)))
    .addSubcommand(sub => sub
      .setName('resolve')
      .setDescription('Moderators: resolve a ticket')
      .addStringOption(o => o.setName('resolution').setDescription('The answer or fix, shown to the participant').setRequired(true).setMaxLength(1500))
      .addBooleanOption(o => o.setName('add_to_knowledge_base').setDescription('Let HackerHelp answer similar questions with this resolution'))
      .addIntegerOption(o => o.setName('number').setDescription('Ticket number (omit inside the ticket thread)').setMinValue(1)))
    .addSubcommand(sub => sub
      .setName('reopen')
      .setDescription('Reopen a resolved ticket')
      .addIntegerOption(o => o.setName('number').setDescription('Ticket number (omit inside the ticket thread)').setMinValue(1))),

  // /analytics
  new SlashCommandBuilder()
    .setName('analytics')
    .setDescription('Moderators: support volume, self-serve rate, tickets and response times')
    .addIntegerOption(o => o.setName('days').setDescription('Window in days (default 30)').setMinValue(1).setMaxValue(365)),

  // /auth
  new SlashCommandBuilder()
    .setName('auth')
    .setDescription('Authenticate and sync your Discord account with HackerHelp'),

  // /register
  new SlashCommandBuilder()
    .setName('register')
    .setDescription('Register as a participant for the active hackathon'),

  // /profile
  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('View your registration profile and team details'),

  // /help
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Display lists of available commands for HackerHelp'),

  // /ask
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask about HackerRank Orchestrate: dates, rules, submissions, interviews, prizes')
    .addStringOption(option => 
      option.setName('question')
        .setDescription('Your question')
        .setMaxLength(1500)
        .setRequired(true)),

  // /track
  new SlashCommandBuilder()
    .setName('track')
    .setDescription('Manage tracks of the hackathon')
    .addSubcommand(subcommand =>
      subcommand.setName('list')
        .setDescription('List all tracks in the active hackathon'))
    .addSubcommand(subcommand =>
      subcommand.setName('info')
        .setDescription('Get details of a specific track')
        .addStringOption(option => 
          option.setName('track_id')
            .setDescription('Hex ID of the track')
            .setRequired(true))),

  // /hackathon
  new SlashCommandBuilder()
    .setName('hackathon')
    .setDescription('Hackathon info commands')
    .addSubcommand(subcommand =>
      subcommand.setName('list')
        .setDescription('List all hackathons organized in the database'))
    .addSubcommand(subcommand =>
      subcommand.setName('info')
        .setDescription('Get details of a specific hackathon')
        .addStringOption(option =>
          option.setName('hackathon_id')
            .setDescription('Hex ID of the hackathon')
            .setRequired(true))),

  // /team
  new SlashCommandBuilder()
    .setName('team')
    .setDescription('Manage your hackathon team')
    .addSubcommand(subcommand =>
      subcommand.setName('create')
        .setDescription('Create a new team')
        .addStringOption(option => 
          option.setName('name')
            .setDescription('Name of your team')
            .setRequired(true))
        .addStringOption(option => 
          option.setName('track_id')
            .setDescription('Hex ID of the track your team is competing in')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand.setName('invite')
        .setDescription('Invite a registered participant to join your team')
        .addUserOption(option => 
          option.setName('user')
            .setDescription('The discord user to invite')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand.setName('info')
        .setDescription('Display information about your team'))
    .addSubcommand(subcommand =>
      subcommand.setName('leave')
        .setDescription('Leave your current team'))
    .addSubcommand(subcommand =>
      subcommand.setName('edit')
        .setDescription('Edit team profile')
        .addStringOption(option => 
          option.setName('name')
            .setDescription('New name for your team')
            .setRequired(false))
        .addStringOption(option => 
          option.setName('track_id')
            .setDescription('New track Hex ID')
            .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand.setName('delete')
        .setDescription('Disband and delete the team (Leaders only)')),

  // /submission
  new SlashCommandBuilder()
    .setName('submission')
    .setDescription('Submit and track your project submission')
    .addSubcommand(subcommand =>
      subcommand.setName('create')
        .setDescription('Create a project submission (requires min 3 team members)')
        .addStringOption(option => option.setName('project_name').setDescription('Project Name').setRequired(true))
        .addStringOption(option => option.setName('problem').setDescription('Problem Statement').setRequired(true))
        .addStringOption(option => option.setName('solution').setDescription('Solution Description').setRequired(true))
        .addStringOption(option => option.setName('tech_stack').setDescription('Comma-separated Tech Stack list').setRequired(true))
        .addStringOption(option => option.setName('github').setDescription('Link to GitHub repository').setRequired(true))
        .addStringOption(option => option.setName('architecture').setDescription('Architecture details').setRequired(false))
        .addStringOption(option => option.setName('innovation').setDescription('Innovation points').setRequired(false))
        .addStringOption(option => option.setName('demo').setDescription('Demo link (external URL)').setRequired(false))
        .addStringOption(option => option.setName('presentation').setDescription('Presentation link (external URL)').setRequired(false))
        .addStringOption(option => option.setName('notes').setDescription('Additional notes').setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand.setName('update')
        .setDescription('Update project submission fields (creates a new version in history)')
        .addStringOption(option => option.setName('project_name').setDescription('New Project Name').setRequired(false))
        .addStringOption(option => option.setName('problem').setDescription('New Problem Statement').setRequired(false))
        .addStringOption(option => option.setName('solution').setDescription('New Solution Description').setRequired(false))
        .addStringOption(option => option.setName('tech_stack').setDescription('New Comma-separated Tech Stack list').setRequired(false))
        .addStringOption(option => option.setName('github').setDescription('New GitHub repository link').setRequired(false))
        .addStringOption(option => option.setName('architecture').setDescription('New Architecture details').setRequired(false))
        .addStringOption(option => option.setName('innovation').setDescription('New Innovation points').setRequired(false))
        .addStringOption(option => option.setName('demo').setDescription('New Demo link').setRequired(false))
        .addStringOption(option => option.setName('presentation').setDescription('New Presentation link').setRequired(false))
        .addStringOption(option => option.setName('notes').setDescription('New Additional notes').setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand.setName('status')
        .setDescription('Show status of your team submission'))
    .addSubcommand(subcommand =>
      subcommand.setName('history')
        .setDescription('Show version history of your submissions')),

  // /announcement
  new SlashCommandBuilder()
    .setName('announcement')
    .setDescription('Create professional, short, and Discord announcements using AI (Admins only)')
    .addStringOption(option => option.setName('hackathon_id').setDescription('Hex ID of the hackathon').setRequired(true))
    .addStringOption(option => option.setName('title').setDescription('Title of the announcement').setRequired(true))
    .addStringOption(option => option.setName('draft_content').setDescription('Draft or points to build the announcement from').setRequired(true)),

  // /index
  new SlashCommandBuilder()
    .setName('index')
    .setDescription('Upload and index documentation for the RAG pipeline')
    .addSubcommand(subcommand =>
      subcommand.setName('pdf')
        .setDescription('Provides details on uploading lightweight PDF/DOCX files via the Express Dashboard'))
    .addSubcommand(subcommand =>
      subcommand.setName('channel')
        .setDescription('Index the history of a Discord channel (Admins only)')
        .addChannelOption(option => 
          option.setName('channel')
            .setDescription('The channel to index')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand.setName('reindex')
        .setDescription('Trigger indexing check of documents')),

  // /judge
  new SlashCommandBuilder()
    .setName('judge')
    .setDescription('Judging operations dashboard (Judges and Track Admins only)')
    .addSubcommand(subcommand =>
      subcommand.setName('dashboard')
        .setDescription('View submissions assigned to you for scoring'))
    .addSubcommand(subcommand =>
      subcommand.setName('review')
        .setDescription('Evaluate and score a project submission')
        .addStringOption(option => 
          option.setName('submission_id')
            .setDescription('Hex ID of the submission')
            .setRequired(true))
        .addIntegerOption(option => option.setName('innovation').setDescription('Innovation (1-10)').setRequired(true).setMinValue(1).setMaxValue(10))
        .addIntegerOption(option => option.setName('complexity').setDescription('Technical Complexity (1-10)').setRequired(true).setMinValue(1).setMaxValue(10))
        .addIntegerOption(option => option.setName('implementation').setDescription('Implementation (1-10)').setRequired(true).setMinValue(1).setMaxValue(10))
        .addIntegerOption(option => option.setName('scalability').setDescription('Scalability (1-10)').setRequired(true).setMinValue(1).setMaxValue(10))
        .addIntegerOption(option => option.setName('presentation').setDescription('Presentation (1-10)').setRequired(true).setMinValue(1).setMaxValue(10))
        .addIntegerOption(option => option.setName('business_value').setDescription('Business Value (1-10)').setRequired(true).setMinValue(1).setMaxValue(10))
        .addIntegerOption(option => option.setName('ux').setDescription('UX (1-10)').setRequired(true).setMinValue(1).setMaxValue(10))
        .addIntegerOption(option => option.setName('impact').setDescription('Impact (1-10)').setRequired(true).setMinValue(1).setMaxValue(10))
        .addStringOption(option => option.setName('comment').setDescription('Feedback comment').setRequired(false))),

  // /admin
  new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Super Admin and Event Admin operations')
    .addSubcommand(subcommand =>
      subcommand.setName('analytics')
        .setDescription('View high-level analytics dashboard in Discord'))
    .addSubcommand(subcommand =>
      subcommand.setName('settings')
        .setDescription('Modify hackathon status')
        .addStringOption(option => option.setName('hackathon_id').setDescription('Hex ID of the hackathon').setRequired(true))
        .addStringOption(option => 
          option.setName('status')
            .setDescription('Set status')
            .setRequired(true)
            .addChoices(
              { name: 'Upcoming', value: 'Upcoming' },
              { name: 'Registration Open', value: 'Registration Open' },
              { name: 'Registration Closed', value: 'Registration Closed' },
              { name: 'Submission Open', value: 'Submission Open' },
              { name: 'Submission Closed', value: 'Submission Closed' },
              { name: 'Judging', value: 'Judging' },
              { name: 'Completed', value: 'Completed' },
              { name: 'Archived', value: 'Archived' }
            )))
    .addSubcommand(subcommand =>
      subcommand.setName('roles')
        .setDescription('Manage users roles in HackerHelp')
        .addUserOption(option => option.setName('user').setDescription('Target discord member').setRequired(true))
        .addStringOption(option => 
          option.setName('action')
            .setDescription('Grant or Revoke')
            .setRequired(true)
            .addChoices(
              { name: 'Grant', value: 'grant' },
              { name: 'Revoke', value: 'revoke' }
            ))
        .addStringOption(option => 
          option.setName('role')
            .setDescription('Select role to modify')
            .setRequired(true)
            .addChoices(
              { name: 'Super Admin', value: 'super_admin' },
              { name: 'Event Admin', value: 'event_admin' },
              { name: 'Track Admin', value: 'track_admin' },
              { name: 'Judge', value: 'judge' },
              { name: 'Mentor', value: 'mentor' }
            )))
].map(command => command.toJSON());
