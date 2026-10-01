# HackerHelp

**Discord-native AI support and hackathon operations bot.**

HackerHelp answers participant questions in a hackathon Discord server from a curated, cited knowledge base, and hands off to humans when it shouldn't answer. The knowledge base targets [HackerRank Orchestrate](https://www.hackerrank.com/hackerrank-orchestrate-october26), a monthly 24-hour AI agent hackathon whose Discord gets the same questions every edition (dates, prizes, submission format, the AI judge interview), answered by hand by the organizers.

The bot also includes hackathon operations workflows: registration, teams, submissions, judging, announcements, and role-based administration.

> HackerHelp is an independent project. It is not affiliated with or endorsed by HackerRank, and its knowledge base is an unofficial summary of public sources.

## How a question is answered

```text
Discord /ask or @mention
  │
  ├─ 1. Input bounds ─────────────── empty or > 1500 chars → ask to rephrase
  ├─ 2. Prompt-injection gate ────── "ignore previous instructions…" → refuse (no API calls)
  ├─ 3. Sensitive-case gate ──────── prize payment, account compromise, appeals, score disputes,
  │                                  conduct reports, data requests → always escalate to a human
  ├─ 4. Retrieval ─────────────────── OpenAI embedding → Supabase pgvector (top 6, floor 0.25)
  ├─ 5. Model decision ────────────── JSON-schema output: answer | clarify | escalate | out_of_scope
  │                                  + cited section IDs + one-line justification
  └─ 6. Validation ────────────────── an answer must cite a section that was actually retrieved and
                                     scores ≥ 0.30, otherwise it is downgraded to an escalation
```

The model proposes and code decides. The model never sees a gated message, so it cannot answer a prize-payment question or be talked out of an escalation. Every answer shows its sources, and every decision is logged with its reason, best similarity, and latency.

Thresholds come from measured data, not guesses: see [eval/RESULTS.md](eval/RESULTS.md). Retrieval found the right document for 24/24 answerable questions, and off-topic questions retrieved nothing above the floor.

## Features

- **Grounded Q&A**: `/ask` and @mentions, with source links, verification labels for older or community-compiled facts, and a clear handoff when the bot won't answer.
- **Curated knowledge base**: Markdown in [knowledge/](knowledge/) with front matter (source URL, verification level). `npm run kb:ingest` is idempotent: content hashes skip unchanged files, and each document is replaced atomically in one Postgres transaction.
- **Evaluation harness**: `npm run eval:rag` runs 41 labelled cases covering paraphrases, Hinglish, sensitive requests, vague and off-topic messages, and prompt injection.
- **Bounded retries**: OpenAI calls retry transient failures with capped, jittered backoff, and fail fast on quota exhaustion or long `Retry-After` instead of hanging Discord interactions ([src/services/retry.ts](src/services/retry.ts)).
- **Additional sources**: admin upload of PDF, DOCX, Markdown, and text files, and indexing of a channel's recent history. Re-indexing replaces the previous version.
- **Hackathon operations**: registration and profiles, teams (invites, leadership transfer), submissions with version history, judge rubric scoring and AI-assisted summaries, an announcement composer, roles, and audit logging.
- **Operations**: startup config validation, liveness and readiness probes, graceful shutdown, a token-protected admin API, and structured JSON logs.
## Architecture

```text
Discord ──► Discord.js bot ──► answer pipeline ──► OpenAI (embeddings, chat)
                │                     │
                │                     └──────────► Supabase Postgres + pgvector
                │                                  (documents, sections, upsert/match RPCs)
                └──► hackathon services ─────────► MongoDB (users, teams, submissions,
                                                    judging, audit log)
Express: /health, /ready, /api/* (bearer token)
```

See [explanation.md](explanation.md) for the code layout and data flow.

## Tech stack

TypeScript on Node.js 24, Discord.js 14, OpenAI Node SDK, Supabase (Postgres, pgvector, Storage), MongoDB with Mongoose, Express, Docker Compose, GitHub Actions.

## Setup

### 1. Configure

```bash
git clone https://github.com/sumyuck/HackerHelp.git
cd HackerHelp
npm install
cp .env.example .env
```

| Variable | Purpose |
| --- | --- |
| `DISCORD_TOKEN` | Discord bot token |
| `DISCORD_CLIENT_ID` | Discord application ID |
| `DISCORD_GUILD_ID` | Development server ID for instant command registration; omit to register globally |
| `OPENAI_API_KEY` | Server-side OpenAI API key (a project with billing enabled; the free tier allows 50 chat requests per day) |
| `OPENAI_CHAT_MODEL` | Chat model with structured-output support, e.g. `gpt-4.1-mini` |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` (the schema uses 1536 dimensions) |
| `MONGODB_URI` | MongoDB connection string (`MONGO_URI` accepted as a legacy fallback) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role or secret key (server-side only) |
| `SUPER_ADMIN_IDS` | Comma-separated Discord user IDs with full admin rights |
| `ADMIN_API_TOKEN` | Bearer token (32+ chars) for `/api/*`; the API is disabled if unset. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `RAG_RETRIEVAL_FLOOR`, `RAG_ANSWER_MIN_SIMILARITY`, `RAG_TOP_K` | Optional retrieval tuning; defaults 0.25 / 0.30 / 6 |
| `LOG_LEVEL`, `PORT` | Optional; defaults `info` and `3000` |

Startup validates this configuration and exits with a list of every missing or malformed value.

### 2. Supabase

In a new Supabase project's SQL editor, run [supabase/schema.sql](supabase/schema.sql), then each file in [supabase/migrations/](supabase/migrations/) in order. Database functions are executable only by the service role.

If you change the embedding model, update the vector dimensions in the schema and re-run `npm run kb:ingest`. The content hash includes the model name, so every document is re-embedded.

### 3. Discord

In the Developer Portal, enable **Message Content Intent**. Invite the bot with the `bot` and `applications.commands` scopes and permission to view channels, send messages, embed links, and read message history.

### 4. Run

```bash
docker compose up -d --build
docker compose exec app node dist/discord/register-commands.js
docker compose exec app node dist/scripts/ingest-knowledge.js
```

Compose runs the bot and MongoDB. It publishes ports on loopback only, health-checks the app via `/ready`, and restarts it on failure. Without Docker, use `npm run dev` (or `npm run build && npm start`), `npm run register-commands`, and `npm run kb:ingest`.

`npm run seed` adds a sample event and tracks for the hackathon operations commands.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` / `build` / `start` | Develop, compile, run |
| `npm run register-commands` | Register slash commands |
| `npm run kb:ingest` | Sync `knowledge/` to Supabase (`-- --prune` deletes removed docs, `-- --dry-run` previews) |
| `npm run eval:rag` | Evaluate the answer pipeline (`-- --retrieval-only` makes no chat calls) |
| `npm run seed` | Sample hackathon data |
| `npm test` | Unit tests: config, API auth, chunking, triage rules, answer pipeline, retry policy. Network calls are mocked. |

Operators can also `POST /api/documents/upload` (multipart `file`, `Authorization: Bearer <ADMIN_API_TOKEN>`). Admins can run `/index channel` in Discord.

## Known limitations

- The knowledge base is hand-curated from public pages and can lag behind HackerRank's official information. Facts from a previous edition are labelled as such in answers.
- Non-English questions retrieve weaker evidence (see eval results). Query rewriting would help at the cost of an extra model call.
- Indexed channel history is community content, not verified fact. It is labelled `community`, and indexing is admin-only.
