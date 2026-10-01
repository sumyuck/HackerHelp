# HackerHelp Architecture and Code Guide

HackerHelp combines Discord workflows, an Express API, MongoDB operational data, and documentation-grounded OpenAI responses.

## Code Layout

```text
src/
├── index.ts                    # Loads configuration and starts MongoDB, HTTP, and Discord
├── app.ts                      # Express middleware, routes, and health endpoint
├── controllers/                # Document upload and aggregate metrics
├── routes/api.ts               # HTTP route definitions
├── database/                   # Mongoose models, connection, sample seed, rules uploader
├── discord/                    # Slash command definitions, registration, handlers, bot events
├── services/
│   ├── openai.service.ts       # Shared official OpenAI SDK client and model configuration
│   ├── embedding.service.ts    # OpenAI embeddings for documents and questions
│   ├── docmind.service.ts      # Supabase storage, chunking, retrieval, grounded chat
│   ├── parser.service.ts       # PDF and DOCX text extraction
│   └── *.service.ts            # User, event, team, submission, and judging workflows
└── tests/                      # Existing constraints checks and RAG regression tests
supabase/schema.sql             # Fresh-project storage and vector schema
```

Existing internal DocMind function names remain to preserve callers. The visible product name is HackerHelp.

## Operational Data

MongoDB models store users and global roles, hackathons and tracks, registrations, teams and memberships, submissions and version history, judge evaluations, and audit logs. Existing service methods continue to enforce workflow permissions and submission constraints.

`MONGODB_URI` selects the database; the legacy `MONGO_URI` variable is accepted as a fallback. Keep your existing connection string to retain data.

## Documentation Ingestion

1. An administrator uploads a file through the Express endpoint or indexes Discord channel history.
2. PDF and DOCX content is extracted to Markdown; text and Markdown are handled directly.
3. The service uploads the content to the private Supabase `files` bucket and records its storage object UUID in `documents`.
4. Markdown is split into sections, which are embedded through `openai.embeddings.create` using `OPENAI_EMBEDDING_MODEL`.
5. Sections and vectors are stored in `document_sections`.

Fresh schemas allow an optional document creator. Existing schemas can retain their `created_by` requirements through `SUPABASE_DOCUMENT_OWNER_ID` or an existing document creator. Deleting a storage object cascades to its document and sections in the included schema.

## Grounded Question Answering

1. `/ask` or a bot mention supplies the Discord question.
2. The same OpenAI embedding model produces a query vector.
3. `match_document_sections` performs cosine similarity search in Supabase pgvector. The service retains the existing `0.3` retrieval threshold and retrieves up to five sections.
4. If no nonempty sections match, the service explicitly reports missing information without calling a chat model.
5. A HackerHelp system prompt restricts answers to retrieved documentation, treats document text as reference data, and requires an explicit missing-information response for unanswered or unrelated questions.
6. `openai.chat.completions.create` uses `OPENAI_CHAT_MODEL` to generate the Discord reply.

Caller-provided system messages do not override the grounding policy. Announcement and judging AI helpers continue to use this same policy. Provider errors return a short retry message instead of exposing API error details to Discord users.

## Vector Migration

The fresh-project schema uses `vector(1536)` for `text-embedding-3-small`. Existing vectors must be regenerated with OpenAI before using this version. Preserve the source documents, align the column and RPC dimensions with the configured model, and rebuild the index by re-uploading those documents. Never mix vectors from different embedding models. See [README.md](README.md) for setup and migration details.

## Runtime and Interfaces

The entry point loads `.env`, connects to MongoDB, starts Express, and logs in to Discord. `/health` reports process availability. `/api/documents/upload` parses and indexes documentation; `/api/analytics` returns existing aggregate metrics. HTTP authentication is not implemented, so keep these endpoints within a trusted admin environment.

Slash command definitions and registration remain in `src/discord`. Roles include participant, mentor, judge, track admin, event admin, and super admin. Operational actions write MongoDB audit records.

## Verification

`npm run build` checks TypeScript compilation. `npm test` runs the existing constraints checks and regression tests for OpenAI embeddings, Supabase retrieval, no-match behavior, grounded prompts, ingestion, and provider failures without real API calls. CI runs install, build, and tests on Node.js 24.
