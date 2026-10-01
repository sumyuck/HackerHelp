---
title: How submissions are evaluated
source_url: https://www.hackerrank.com/blog/behind-the-scenes-of-hackerrank-orchestrate/
source_title: Behind the Scenes of HackerRank Orchestrate (HackerRank blog)
verification: derived
last_reviewed: 2026-10-02
---

# How submissions are evaluated

Every submission is graded on four independent signals, each scored 0-100. The same model and method score the whole cohort. The weights below are from the first (May 2026) edition. HackerRank said future editions would iterate on them, so treat them as a guide.

## Final score (May 2026)

Final Score = 0.30 x Code + 0.30 x Output + 0.30 x AI Judge Interview + 0.10 x Chat Transcript

The chat transcript weight was held at 10% because of upload errors and signs of manipulation in that edition.

Tie-breaker: if final scores tie, raw scores are compared in this order: AI judge interview, code, output, chat transcript.

## Code (agent design)

| Dimension | Weight | What it measures |
| --- | --- | --- |
| Agent architecture | 30% | A real agent (tool-calling loops, model-driven routing, handoffs) rather than a hardcoded workflow |
| Prompt and tool craft | 30% | System prompts and tool descriptions: roles, constraints, structured output, refusal conditions |
| Agent robustness | 25% | Guardrails, retries, iteration caps, output validation, retrieval quality |
| Engineering rigor | 15% | Modularity, types, secrets in environment variables, function size |

Only what is observable in the source code counts. README claims and comments that describe behaviour the code does not implement earn nothing.

## Output

Each provided case is checked against a hidden golden dataset: the decision, labels, and justification are all scored. A separate safety score reflects how the agent handled adversarial inputs such as prompt injection. A correct decision with an empty, generic, or contradictory justification is capped at about 70.

## Chat transcript

| Dimension | Weight |
| --- | --- |
| Direction and architecture ownership | 35% |
| Technical specificity and constraints | 25% |
| Iteration and verification | 25% |
| Safety, edge case, and quality awareness | 15% |

The transcript is judged on how you directed your AI coding tools (planning, constraints, debugging, iteration), not on the agent you built.

## AI judge interview

See "The AI judge interview" for the interview rubric.

## What top submissions had in common

Every top-10 participant scored in the top quartile on all four signals. The strongest systems combined retrieval-grounded LLM reasoning with deterministic safety checks, fixed output schemas, citation validation, retries and fallbacks, and evaluation against sample cases.
