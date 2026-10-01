# HackerHelp

**Discord-native AI support and hackathon operations bot.**

HackerHelp is a Discord-native AI support and hackathon operations bot that automates community support, FAQ resolution, participant workflows, team management, submissions, judging, announcements, and role-based administration.

## What it does

- AI-powered documentation Q&A through `/ask` and bot mentions, with grounded responses restricted to retrieved community and hackathon documentation.
- Retrieval-Augmented Generation (RAG) over FAQs, rules, and event documentation, including PDF, DOCX, Markdown, text, and Discord channel history ingestion.
- Participant registration and profiles.
- Team creation, invites, membership, and leadership controls.
- Project submissions and submission version history.
- Judge assignments, rubric scoring, evaluation reports, and AI-assisted project summaries.
- AI-assisted announcement composition.
- Role-based administration, audit logging, and Discord slash commands.
- Existing aggregate metrics through `/admin analytics` and the Express API.

Planned additions: semantic ticket deduplication, confidence scoring, automated ticket escalation, an analytics dashboard UI, Redis queues, and support for large-scale production usage. These features are not implemented in this initial migration. HackerRank-specific support workflows are also outside this release.

## Architecture

```text
Discord
   |
Discord.js Bot
   |
Node.js / TypeScript Services
   |----------------------|
MongoDB                RAG Service
                           |
                     OpenAI Embeddings
                           |
                     Supabase pgvector
                           |
                      OpenAI Model
                           |
                      Discord Reply
```

MongoDB stores participants, events, teams, submissions, judging data, and audit logs. Supabase stores source documents and vectorized document sections. Both document ingestion and question retrieval use the same OpenAI embedding model. Retrieved sections supply the chat model's factual context. When no sections match, HackerHelp returns an explicit “couldn't find” response without calling the chat model; its system prompt also requires that response when retrieved sections do not answer the question.

See [the architecture guide](explanation.md) for the code layout and workflow details.

## Tech Stack

- TypeScript and Node.js 22+ (Node.js 24 recommended; see `.nvmrc`)
- Express
- Discord.js
- OpenAI API through the official Node.js SDK
- MongoDB / Mongoose
- Supabase Storage and PostgreSQL / pgvector
- Docker and Docker Compose

## Local Setup

### 1. Install and configure

```bash
git clone https://github.com/sumyuck/HackerHelp.git
cd HackerHelp
npm install
cp .env.example .env
```

Fill in `.env` with your own credentials. Real `.env` files are ignored by Git and excluded from Docker builds.

| Variable | Purpose |
| --- | --- |
| `DISCORD_TOKEN` | Discord bot token |
| `DISCORD_CLIENT_ID` | Discord application's client ID |
| `DISCORD_GUILD_ID` | Development server ID for immediate guild command registration; omit for global registration |
| `OPENAI_API_KEY` | Server-side OpenAI API key |
| `OPENAI_CHAT_MODEL` | Chat Completions compatible model available to your project; example: `gpt-4.1-mini` |
| `OPENAI_EMBEDDING_MODEL` | Embedding model; example: `text-embedding-3-small` |
| `MONGODB_URI` | MongoDB connection string; local example included |
| `SUPABASE_URL` | Your Supabase project's URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase service role key |
| `SUPABASE_DOCUMENT_OWNER_ID` | Optional existing Supabase Auth user UUID if your document schema requires a creator |
| `SUPER_ADMIN_IDS` | Comma-separated Discord user IDs with administrator access |
| `PORT` | HTTP port; defaults to `3000` |

OpenAI models must be configured explicitly; the sample values in `.env.example` are starting points. The included vector schema expects **1536 dimensions**, matching `text-embedding-3-small`. If you change embedding models, adjust the schema to that model's output dimensions and re-index all documents. API calls require an OpenAI API project with access and billing configured. [OpenAI embedding documentation](https://developers.openai.com/api/docs/guides/embeddings).

`MONGO_URI` remains supported as a legacy fallback so existing database configurations continue to work. `MONGODB_URI` takes precedence. Set it to your existing database URI to retain existing participant and event data.

### 2. Prepare MongoDB and Supabase

Run MongoDB locally, use a managed MongoDB instance, or start the included container:

```bash
docker compose up -d mongodb
```

For a **new Supabase project**, run [supabase/schema.sql](supabase/schema.sql) in its SQL editor. This creates the private `files` storage bucket, `documents` and `document_sections` tables, and the `match_document_sections` RPC. Database access is restricted to the server-side service role.

For an **existing Supabase installation**, back up its schema and documents first. Retain the `files` bucket and document records, update `document_sections.embedding` and the matching RPC to the configured model's dimensions, and replace all previous vectors by re-indexing the source documents. Vectors produced by different models are incompatible even if their dimensions match. Do not run the fresh-project SQL over existing tables. If `documents.created_by` is required, set `SUPABASE_DOCUMENT_OWNER_ID` to a valid existing Auth user UUID; the uploader otherwise reuses an existing document creator when available.

### 3. Configure Discord and commands

In the Discord Developer Portal, enable the **Message Content Intent** for mention-based Q&A. Invite the bot with the `bot` and `applications.commands` scopes. Give it permissions to view channels, send messages, embed links, and read message history in channels you intend to index. Put your Discord user ID in `SUPER_ADMIN_IDS`.

```bash
npm run register-commands
```

Set the bot's display name to **HackerHelp** in the Developer Portal; repository branding cannot change an existing Discord application name.

### 4. Seed, build, and start

Optionally create a sample event and tracks in an empty MongoDB database:

```bash
npm run seed
```

Seeding skips databases that already contain an event. Edit the sample event configuration in [src/database/seed.ts](src/database/seed.ts) before using it for a real event.

```bash
npm run build
npm start
```

For development, use `npm run dev`. The bot and API run together; the health endpoint is `http://localhost:3000/health` by default.

### 5. Index documentation

Edit [rules.txt](rules.txt) for your event. With the app running, upload it from a second terminal:

```bash
npm run upload-rules
```

The script uses the first `SUPER_ADMIN_IDS` entry. Administrators can also upload `.pdf`, `.docx`, `.md`, or `.txt` files (up to 10 MB) through `POST /api/documents/upload` using multipart fields `file` and `actorId`, or index channel history through `/index channel`. `/index reindex` currently reports indexing status; it does not regenerate embeddings. Re-upload source documents when rebuilding the vector index.

Try `/auth`, `/register`, `/help`, and `/ask` in Discord, or mention the bot with a question about the indexed rules.

## Commands and Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Run the TypeScript development server |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled bot and API |
| `npm run register-commands` | Register existing Discord slash commands |
| `npm run seed` | Add sample hackathon data to an empty database |
| `npm run upload-rules` | Upload and index `rules.txt` |
| `npm test` | Run existing constraints checks and mocked OpenAI/Supabase RAG regression tests |

The main command families are `/auth`, `/register`, `/profile`, `/help`, `/ask`, `/hackathon`, `/track`, `/team`, `/submission`, `/announcement`, `/index`, `/judge`, and `/admin`. Use `/help` for available workflows.

## Docker

After configuring `.env` and Supabase:

```bash
docker compose up --build
```

Compose runs the bot/API and MongoDB, sets the app's MongoDB host to `mongodb`, and persists database data in a named volume. Supabase and OpenAI remain external services. Container builds use the checked-in lockfile and exclude local credentials.
