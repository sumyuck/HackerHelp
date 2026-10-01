# HackerHelp Architecture and Code Guide

HackerHelp combines Discord workflows, an Express API, MongoDB operational data, and a retrieval-grounded answer pipeline backed by OpenAI and Supabase pgvector.

## Code Layout

```text
src/
├── index.ts                     # Validates config, starts MongoDB, HTTP, and Discord; graceful shutdown
├── config.ts                    # Startup configuration validation
├── logger.ts                    # Shared structured JSON logger
├── app.ts                       # Express middleware, routes, liveness and readiness probes
├── middleware/admin-auth.ts     # Bearer-token guard for the operator HTTP API
├── controllers/                 # Document upload and aggregate metrics
├── routes/api.ts                # HTTP route definitions
├── knowledge/markdown.ts        # Front-matter parsing and heading-aware chunking (pure)
├── database/                    # Mongoose models, connection, sample seed
├── discord/
│   ├── bot.ts                   # Gateway events: interactions and direct @mentions
│   ├── commands-handler.ts      # Slash command handlers
│   ├── answer-presenter.ts      # Renders an AnswerResult as a Discord embed
│   └── command-definitions.ts   # Slash command schemas and registration
├── services/
│   ├── answer.service.ts        # Gates → retrieval → structured model decision → validation
│   ├── triage-rules.ts          # Deterministic prompt-injection and sensitive-case gates
│   ├── knowledge.service.ts     # Supabase: atomic document upsert, vector search, storage
│   ├── embedding.service.ts     # Batched OpenAI embeddings
│   ├── openai.service.ts        # OpenAI client and free-form generation (announcements, summaries)
│   ├── retry.ts                 # Bounded retry policy for upstream calls
│   ├── parser.service.ts        # PDF and DOCX text extraction
│   └── *.service.ts             # User, event, team, submission, and judging workflows
├── scripts/
│   ├── ingest-knowledge.ts      # Idempotent sync of knowledge/ into Supabase
│   └── eval-rag.ts              # Labelled evaluation of the answer pipeline
└── tests/                       # Unit tests (network mocked)
knowledge/                       # Curated Markdown knowledge base with source front matter
eval/                            # Evaluation cases and recorded results
supabase/                        # schema.sql plus ordered migrations
```

## Answer Pipeline

`answerQuestion()` in `src/services/answer.service.ts` returns an `AnswerResult` with an outcome (`answered`, `clarify`, `escalate`, `out_of_scope`, `refused`, `error`), the user-facing message, citations, the best supporting similarity, a machine-readable reason, and the retrieved sections, which are kept as handoff context.

1. **Input bounds.** Messages under 3 or over 1500 characters get a clarification request, with no API calls.
2. **Prompt-injection gate.** High-precision patterns (instruction overrides, prompt-reveal requests, persona switches) are refused before retrieval. Subtler attempts are handled by the system prompt, which treats both the message and the documentation as data.
3. **Sensitive-case gate.** Prize payment status, account compromise, disqualification appeals, score disputes, reports about other participants, and personal-data requests always escalate. Retrieval still runs so the handoff carries context, but the model is not called, so it cannot override the decision. Patterns require first-person or reporting context so informational questions ("is using AI cheating?", "what gets you disqualified?") still get answers. Both cases are covered by tests.
4. **Retrieval.** The question is embedded with `OPENAI_EMBEDDING_MODEL`. `match_document_sections` returns the top 6 sections above the 0.25 floor, joined with document title, source URL, origin, and verification label.
5. **Model decision.** Chat Completions with a strict JSON schema at temperature 0. Sections are passed as `<section id="S1" … verification="derived">` blocks. The model returns a decision, the answer or clarifying question, cited section IDs, and a one-sentence reason.
6. **Validation.** An `answer` is accepted only if it cites at least one ID that maps to a supplied section, and the best cited section scores at least 0.30. Otherwise it is downgraded to `escalate` with reason `validation_downgrade:*`. A `clarify` without a question also escalates.

Every decision is logged with outcome, reason, gate category, best similarity, cited documents, and latency. Threshold choices and their evidence are in [eval/RESULTS.md](eval/RESULTS.md).

## Knowledge Ingestion

- **Curated knowledge base.** `knowledge/**/*.md` files carry front matter (`title`, `source_url`, `verification: official | derived | community`). The path is the stable slug. `kb:ingest` computes a SHA-256 over the body, metadata, chunker version, and embedding model, and skips documents whose stored hash matches. A no-op sync makes zero API calls. `--prune` deletes indexed knowledge-base documents whose files were removed.
- **Chunking.** One chunk per heading section, prefixed with its breadcrumb (`FAQ > Can I use my own tools?`), so short sections remain meaningful to the embedding model. Long sections split on paragraph boundaries.
- **Atomic replace.** `upsert_document` (migration 002) inserts or updates the document and replaces all its sections in one transaction. A failure part-way through never leaves a document with a new hash but stale or missing vectors.
- **Other origins.** Admin file uploads (`upload/<filename>`, original kept in the private `files` bucket) and channel archives (`discord/<channelId>`, labelled `community`) use the same path. Re-indexing replaces the previous version.

## Upstream Failure Handling

The OpenAI SDK's own retries are disabled (`maxRetries: 0`) because it sleeps for whatever `Retry-After` the server sends. A daily-quota 429 requests about 30 minutes, which outlives a Discord interaction. `withRetry` retries 408, 409, 429, 5xx, and network errors up to 3 attempts, using full-jitter exponential backoff capped at 8 s. It fails fast with `UpstreamUnavailableError` (carrying `retryAfterMs`) on quota exhaustion or a longer `Retry-After`. The pipeline turns that into a "busy, try again shortly" reply. Sensitive messages still escalate when retrieval is down.

## Operational Data

MongoDB stores users and global roles, hackathons and tracks, registrations, teams and memberships, submissions and version history, judge evaluations, and audit logs. Service methods enforce workflow permissions and submission constraints.

## Runtime and Interfaces

The entry point loads `.env`, validates configuration (`src/config.ts`), connects to MongoDB, starts Express, and logs in to Discord. It shuts these down in reverse order on `SIGTERM`/`SIGINT`. `/health` reports process liveness and `/ready` reports MongoDB and Discord connectivity.

`/api/documents/upload` parses and indexes documentation; `/api/analytics` returns aggregate metrics. Every `/api/*` route requires `Authorization: Bearer <ADMIN_API_TOKEN>` (constant-time comparison), and the API is disabled when no token is configured. Request-body identity claims such as Discord user IDs are never treated as credentials.

The bot responds only to direct @mentions: `@everyone` and role pings are ignored. The announcement composer and judge project summaries use free-form generation (`composeText`), not the knowledge-base pipeline, and treat participant-written text as data.

## Verification

`npm test` runs the unit suites without network access. They cover config validation, API auth, front matter and chunking, the checked-in knowledge base files, triage-rule true and false positives, the answer pipeline's gates and downgrade paths, failure handling, and the retry policy. `npm run eval:rag` measures the live pipeline against labelled cases. CI runs install, build, and tests on Node.js 24.
