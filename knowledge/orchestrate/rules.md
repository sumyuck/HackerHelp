---
title: Participation rules
source_url: https://github.com/interviewstreet/hackerrank-orchestrate-may26
source_title: HackerRank Orchestrate May 2026 public repository
verification: derived
last_reviewed: 2026-10-02
---

# Participation rules

These rules come from the public May 2026 edition. Each edition's problem statement can add or change rules, so always read the rules sent with your edition's problem.

## Solo authorship

- Orchestrate is a solo challenge. You must be the author of your submission.
- Teams are not allowed. You cannot share code or submit someone else's work.

## Tools

- You may use any IDE, AI assistant, or tool to help you build (for example Cursor, Claude Code, Codex, Gemini CLI, or GitHub Copilot).
- What is evaluated is what your agent does and how you directed your AI tools, not whether you used AI.

## Agent behaviour requirements (May 2026 problem)

- The agent must use only the support corpus provided with the problem. Live web calls were not allowed.
- It must escalate high-risk, sensitive, or unsupported cases instead of guessing.
- It must not invent policies or make unsupported claims.

## Engineering requirements

- Read secrets such as API keys from environment variables. Never hardcode keys. Use a `.env` file (gitignored) and commit a `.env.example`.
- Include a README in your code explaining how to install and run it.
- Aim for deterministic behaviour, for example by seeding any random sampling.

## Conduct

Follow the #rules-regulations channel in the Orchestrate Discord. Be respectful, do not share solutions during an active challenge, and do not post personal information in public channels.
