# Answer pipeline evaluation

Labelled cases: [rag-cases.json](rag-cases.json) (41 questions: 24 answerable, 6 that must hit a
deterministic escalation gate, 3 the docs cannot answer, 2 vague, 3 off-topic, 3 prompt injections).
Each case lists every acceptable outcome, and for answerable questions the knowledge-base documents
that should be retrieved and cited.

```bash
npm run eval:rag                     # full pipeline (embeddings + chat), ~33 chat calls
npm run eval:rag -- --retrieval-only # embeddings + vector search only, no chat calls
npm run eval:rag -- --only gate-     # subset by id prefix
```

Each run writes full per-case output to `eval/results/` (gitignored). This file records the runs
that informed design decisions.

## 2026-10-02: retrieval-only, threshold calibration

Setup: `text-embedding-3-small`, pgvector cosine similarity, HNSW index, top-k 6, retrieval floor
0.25, 10 knowledge-base documents chunked into 56 heading-scoped sections.

| Metric | Result |
| --- | --- |
| Expected source document retrieved in top 6 (answerable cases) | **24 / 24** |
| Off-topic questions with any section above the 0.25 floor | **0 / 3** |
| Similarity of the best expected-source section (answerable cases) | min 0.332 · p25 0.485 · median 0.548 · max 0.790 |
| Top similarity, in-scope questions the docs cannot answer | 0.274 to 0.463 |

Lowest-evidence answerable cases:

| Similarity | Case |
| --- | --- |
| 0.332 | `interview-hinglish`: "bhai interview kitne minute ka hota hai?" |
| 0.404 | `prize-everyone`: "Is there anything for people who don't win?" |
| 0.430 | `eval-tiebreak`: "what happens if two people have the same score" |
| 0.435 | `submit-log-windows`: "Where is log.txt saved on Windows?" |

### Decisions

- **Retrieval floor 0.25.** No off-topic question retrieves anything above it, so off-topic
  messages reach the model with zero context and are classified out of scope instead of being
  answered from loosely related text.
- **Answer similarity bar 0.30, lowered from an initial 0.40.** At 0.40 the Hinglish question,
  whose correct evidence scores 0.332, would be force-escalated. The Orchestrate community spans
  dozens of countries, so mixed-language questions are normal.
- **Similarity is a backstop, not the classifier.** Unanswerable in-scope questions (0.27 to 0.46)
  overlap with answerable ones (0.33 and up). No threshold separates them. The primary judgment
  is the model's structured decision, constrained by code: an answer must cite a section ID that
  was actually supplied, and that section must clear the 0.30 bar, or the answer is downgraded to
  an escalation.

### Known limitations from this run

- Non-English questions retrieve noticeably weaker evidence. Translating or rewriting the query
  before embedding would help, at the cost of one extra model call per question.

## 2026-10-02: full pipeline, `gpt-4o-mini` (partial: rate-limited)

Same retrieval setup, answer bar 0.30. The development API key was on a free-tier project
(50 chat requests per model per day). 13 of 41 cases hit that limit and returned the pipeline's
`upstream_unavailable` error: 5 with quota exhausted, 8 after 3 bounded retries. Each failed in
seconds rather than hanging. These cases measure the account, not the pipeline, and are excluded
below.

| Metric | Result |
| --- | --- |
| Cases that received a model decision or were handled by a gate | 28 / 41 |
| Correct outcome among those | **28 / 28** (27 with the preferred outcome) |
| Answers citing an expected source document | **19 / 19** |
| Deterministic escalation gates (prize, bank details, appeal, account, regrade, cheating report) | 6 / 6, no model call |
| Prompt-injection gate (system-prompt reveal, persona switch) | 2 / 2, no API calls |
| Hinglish question ("bhai interview kitne minute ka hota hai?") | answered, citing the interview doc |

The only non-preferred outcome was `esc-unknown-age` ("Is there a minimum age requirement?"). The
bot answered from the FAQ that the event page lists no eligibility restrictions and suggested
#ask-the-team, which is an acceptable outcome.

Not yet measured because of the rate limit: vague questions (clarify), off-topic questions, and the
subtle "authorized organizer" injection. Re-run with `npm run eval:rag` on a paid-tier key.

An earlier attempt (`gpt-4.1-mini`) hit the same quota and exposed a hang: the OpenAI SDK slept for
the 429's `Retry-After` (about 29 minutes) with no cap. `src/services/retry.ts` now bounds retries
and fails fast, which is why this run completed.
