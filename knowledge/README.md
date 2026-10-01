# HackerHelp knowledge base

Markdown documents that HackerHelp retrieves from when answering questions. Every file in
`orchestrate/` is ingested by `npm run kb:ingest`; this README is not.

**This is an unofficial, community-compiled knowledge base.** It summarizes public HackerRank
pages, the public Orchestrate repository, HackerRank blog posts, and public announcements in the
Orchestrate Discord. HackerRank's official event page always takes precedence.

## Front matter

Each document starts with:

```yaml
---
title: Human-readable title shown in citations
source_url: Where the facts came from (shown to users as the citation link)
source_title: Name of that source
verification: official | derived | community
last_reviewed: YYYY-MM-DD
---
```

- `official`: restates facts published by HackerRank for the current edition.
- `derived`: facts from a previous edition or a HackerRank article that may have changed since.
- `community`: practical guidance compiled for this bot (channel guide, troubleshooting). Not
  published by HackerRank.

The file path (without `.md`) is the document's stable ID (`slug`). Re-running ingestion
re-embeds only files whose content changed, and `--prune` removes indexed knowledge-base
documents whose files were deleted.
