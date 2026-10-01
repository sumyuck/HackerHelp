---
title: How to submit
source_url: https://github.com/interviewstreet/hackerrank-orchestrate-may26
source_title: HackerRank Orchestrate May 2026 public repository
verification: derived
last_reviewed: 2026-10-02
---

# How to submit

The October 2026 event page asks for three things: your code, your agent's output, and your AI chat transcript. The exact file names and upload page are sent with each edition's problem statement. The details below come from the May 2026 edition.

## The three artifacts

1. **Code zip**: your source code. Exclude virtual environments, `node_modules`, build artifacts, data folders, and CSV files.
2. **Agent output**: the output file your agent produced on the provided inputs (in May 2026 this was `support_tickets/output.csv`).
3. **AI chat transcript**: the `log.txt` file recorded while you worked with your AI coding tools.

In May 2026, submissions were uploaded on the HackerRank contest page for the challenge. After a successful submission you take the AI judge interview.

## Chat transcript (log.txt)

The starter repository includes an `AGENTS.md` file that instructs AI coding tools to log every conversation turn automatically. The log is written outside the repository:

- macOS / Linux: `$HOME/hackerrank_orchestrate/log.txt`
- Windows: `%USERPROFILE%\hackerrank_orchestrate\log.txt`

The log is append-only. Do not edit or delete earlier entries, and do not commit it to git. Secrets and personal information are redacted automatically.

## Output file checklist

- Every required row is present, with no missing or duplicated IDs.
- Labels come only from the allowed set given in the problem.
- Columns are exactly as specified.
- Justifications explain the decision with specific evidence, not generic text.

## Code checklist

- Clear entry point and a README with setup steps, dependencies, environment variables, and run commands.
- Secrets read from environment variables.
- Prompt files are part of your implementation. Keep them reviewed and versioned like code.
