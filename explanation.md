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
├── tickets/                     # Ticket state machine and duplicate policy (pure)
├── errors.ts                    # UserFacingError: the only error messages shown in Discord
├── database/                    # Mongoose models, connection, sample seed
├── discord/
│   ├── bot.ts                   # Gateway events: interactions and direct @mentions
│   ├── commands-handler.ts      # Slash command handlers
│   ├── answer-presenter.ts      # Renders an AnswerResult as a Discord embed
│   ├── ticket-forum.ts          # TicketChannel implementation: forum posts, tags, moderator role
│   ├── ticket-interactions.ts   # /ticket commands, ticket buttons, thread replies
│   └── command-definitions.ts   # Slash command schemas and registration
├── services/
│   ├── answer.service.ts        # Gates → retrieval → structured model decision → validation
│   ├── triage-rules.ts          # Deterministic prompt-injection and sensitive-case gates
│   ├── knowledge.service.ts     # Supabase: atomic document upsert, vector search, storage
│   ├── embedding.service.ts     # Batched OpenAI embeddings
│   ├── llm.service.ts           # Claude: structured decisions and free-form drafting
│   ├── openai.service.ts        # OpenAI client (embeddings only)
│   ├── retry.ts                 # Bounded retry policy for upstream calls
│   ├── ticket.service.ts        # Ticket workflows (create, dedup, transitions, resolutions → KB)
│   ├── ticket-classifier.service.ts # Title, summary, category, priority, canonical issue
│   ├── ticket-similarity.service.ts # Ticket vectors in pgvector
│   ├── parser.service.ts        # PDF and DOCX text extraction
│   └── *.service.ts             # User, event, team, submission, and judging workflows
├── scripts/
│   ├── ingest-knowledge.ts      # Idempotent sync of knowledge/ into Supabase
│   ├── eval-rag.ts              # Labelled evaluation of the answer pipeline
│   └── eval-dedup.ts            # Ticket duplicate-threshold calibration
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
5. **Model decision.** Claude via the Anthropic Messages API (`src/services/llm.service.ts`), with structured JSON output (`output_config.format`). The default model is `claude-haiku-4-5`. On models that support them (not Haiku 4.5), requests also set effort `low` and server-side refusal fallback (`fallbacks: "default"`). A refusal escalates the message to a human. Sections are passed as `<section id="S1" … verification="derived">` blocks. The model returns a decision, the answer or clarifying question, cited section IDs, and a one-sentence reason.
6. **Validation.** An `answer` is accepted only if it cites at least one ID that maps to a supplied section, and the best cited section scores at least 0.30. Otherwise it is downgraded to `escalate` with reason `validation_downgrade:*`. A `clarify` without a question also escalates.

Every decision is logged with outcome, reason, gate category, best similarity, cited documents, and latency. Threshold choices and their evidence are in [eval/RESULTS.md](eval/RESULTS.md).

## Support Tickets

Tickets are the handoff path when the answer pipeline should not answer. They are created from the "Open a ticket" / "I still need help" buttons on `/ask` and @mention replies, or with `/ticket open`. `/ticket open` runs the answer pipeline first and offers an answer before opening anything.

**Layers.**
- `src/tickets/ticket-state.ts` is the lifecycle state machine. `src/tickets/dedup-policy.ts` holds the duplicate decision rules. Both are pure and unit-tested.
- `src/services/ticket.service.ts` holds the workflows. It talks to Discord only through the `TicketChannel` port.
- `src/discord/ticket-forum.ts` implements that port as forum posts. `src/discord/ticket-interactions.ts` maps commands and buttons onto the service.

**Creating a ticket.**
1. **Replay check.** The idempotency key is the originating interaction or message ID, stored with a unique index. Double clicks, retried deliveries, and concurrent presses all resolve to one ticket.
2. **Classification.** One Claude call returns a title, a neutral summary without personal data, a category, a priority, and a canonical `<component>: <problem>` issue. Deterministic gate results from the answer pipeline set floors the model cannot lower: a prize-payment question is always `rewards`, at least `high`. If the model is unavailable, a plain fallback classification is used and the ticket is still created.
3. **Duplicate check.** The canonical issue is embedded and matched against the guild's tickets in pgvector (`match_tickets`, migration 003). `decideDuplicate` then applies these rules in order:
   - The participant's own open match at ≥ 0.80 is returned instead of a new ticket.
   - Someone's resolved match at ≥ 0.80 is offered first, with an "open anyway" button.
   - Otherwise the ticket is created, and matches at ≥ 0.65 are listed as related for moderators.
   Canonical statements are used because raw-message embeddings found 0/12 labelled duplicates at that threshold (see [eval/RESULTS.md](eval/RESULTS.md)). Duplicate detection degrades open: if embeddings or vector search fail, the ticket is created without it.
4. **Claim, then act.** The ticket number comes from an atomic per-guild counter. The ticket row is inserted before the forum post is created. If the process dies in between, the next attempt with the same key finds the row and creates the missing post.
5. **Forum post.** The post goes into `#hacker-help-desk` with category and status tags and a moderator-role ping. It includes the summary, the original message, a plain-language reason for escalation, the knowledge-base sections the bot retrieved, and any related tickets.

**Lifecycle.** `open → assigned → waiting_user → resolved`, with `reopen` back to `open`. Assign, waiting, and resolve are moderator-only. Moderators are members with the configured role, or app `super_admin`/`event_admin`. Only the creator (or a moderator) can reopen. Only the creator's reply moves a waiting ticket back to `assigned`, and that happens automatically when they post in the thread. Every transition:
- goes through `transition()`;
- is applied with optimistic concurrency (`findOneAndUpdate` conditioned on the current status, so two moderators resolving at once can't both succeed);
- is appended to the ticket's history;
- updates the forum tags and the pinned summary, and archives the post on resolve.

**Learning from resolutions.** `/ticket resolve add_to_knowledge_base:true` indexes the ticket's neutral summary and the moderator's answer as an `official` knowledge-base document (origin `ticket_resolution`). From then on the answer pipeline can answer that question with a citation to the thread. It is opt-in per ticket, so moderators decide what becomes knowledge.

**Support events.** Each answer outcome, helpful-answer click, prevented duplicate, reused resolution, ticket creation, and transition is appended to `SupportEvent`. Analytics are computed from these facts. Recording never blocks or fails the support flow.

## Knowledge Ingestion

- **Curated knowledge base.** `knowledge/**/*.md` files carry front matter (`title`, `source_url`, `verification: official | derived | community`). The path is the stable slug. `kb:ingest` computes a SHA-256 over the body, metadata, chunker version, and embedding model, and skips documents whose stored hash matches. A no-op sync makes zero API calls. `--prune` deletes indexed knowledge-base documents whose files were removed.
- **Chunking.** One chunk per heading section, prefixed with its breadcrumb (`FAQ > Can I use my own tools?`), so short sections remain meaningful to the embedding model. Long sections split on paragraph boundaries.
- **Atomic replace.** `upsert_document` (migration 002) inserts or updates the document and replaces all its sections in one transaction. A failure part-way through never leaves a document with a new hash but stale or missing vectors.
- **Other origins.** Admin file uploads (`upload/<filename>`, original kept in the private `files` bucket) and channel archives (`discord/<channelId>`, labelled `community`) use the same path. Re-indexing replaces the previous version.

## Upstream Failure Handling

Both SDKs' own retries are disabled (`maxRetries: 0`). The OpenAI SDK sleeps for whatever `Retry-After` the server sends. A daily-quota 429 requests about 30 minutes, which outlives a Discord interaction. `withRetry` wraps every Anthropic and OpenAI call. It retries 408, 409, 429, 5xx (including Anthropic's 529 overloaded), and network errors up to 3 attempts, using full-jitter exponential backoff capped at 8 s. It fails fast with `UpstreamUnavailableError` (carrying `retryAfterMs`) on quota exhaustion or a longer `Retry-After`. The pipeline turns that into a "busy, try again shortly" reply. Sensitive messages still escalate when retrieval is down.

## Operational Data

MongoDB stores users and global roles, hackathons and tracks, registrations, teams and memberships, submissions and version history, judge evaluations, and audit logs. Service methods enforce workflow permissions and submission constraints.

## Runtime and Interfaces

The entry point loads `.env`, validates configuration (`src/config.ts`), connects to MongoDB, starts Express, and logs in to Discord. It shuts these down in reverse order on `SIGTERM`/`SIGINT`. `/health` reports process liveness and `/ready` reports MongoDB and Discord connectivity.

`/api/documents/upload` parses and indexes documentation; `/api/analytics` returns aggregate metrics. Every `/api/*` route requires `Authorization: Bearer <ADMIN_API_TOKEN>` (constant-time comparison), and the API is disabled when no token is configured. Request-body identity claims such as Discord user IDs are never treated as credentials.

The bot responds only to direct @mentions: `@everyone` and role pings are ignored. The announcement composer and judge project summaries use free-form generation (`composeText`), not the knowledge-base pipeline, and treat participant-written text as data.

## Verification

`npm test` runs the unit suites without network access. They cover config validation, API auth, front matter and chunking, the checked-in knowledge base files, triage-rule true and false positives, the answer pipeline's gates and downgrade paths, failure handling, the retry policy, and the ticket state machine, duplicate policy, and classifier floors. `npm run eval:rag` measures the live pipeline against labelled cases. CI runs install, build, and tests on Node.js 24.
