---
description: Wrap up the current task — review the session, propose learnings, and update the right retrospective (global vs project) after approval
argument-hint: [optional focus, e.g. "auth refactor"]
allowed-tools: Read, Edit, Write, Bash(git status:*), Bash(git diff:*), Bash(git log:*)
---

## Context

- Current git status: !`git status --short`
- Diff against HEAD: !`git diff --stat HEAD`
- Recent commits: !`git log --oneline -10`
- Project retrospective (project-specific): @retrospective.md
- Global retrospective lives at `~/.claude/retrospective.md` (org / cross-project) — READ it before proposing so you can route and dedup against it.

## Your task

You are wrapping up a unit of work before moving to the next task$ARGUMENTS.
Run a focused retrospective on THIS session. Do not just summarize — extract
what is worth carrying into future sessions, and route each learning to the
right file.

### Step 1 — Analyze the session

Scan the conversation and the git changes above for:

- **Corrections** — places where I corrected you, or you redid work. Highest-value signals.
- **Conventions discovered** — patterns, commands, file layouts, or decisions not obvious from the code.
- **Failures / dead ends** — approaches that looked right but were wrong; record as explicit anti-patterns.
- **Open threads** — anything left unfinished, pending, or deferred.

### Step 2 — Filter hard, then route

Keep only items that are **durable** and **non-redundant** (check BOTH retrospectives above; if an entry already covers it, plan to UPDATE/MERGE, not duplicate). Drop general coding knowledge and changelog-style history.

Route each kept item:

- **Global (`~/.claude/retrospective.md`)** — reusable across projects: company systems, shared infra/DB, auth, internal repos/portals, team/business context, cross-project conventions.
- **Project (`./retrospective.md`)** — specific to THIS repo: its conventions, decisions, anti-patterns, open threads.

If nothing meets the bar, say so plainly and stop. An empty retrospective is better than a noisy one.

### Step 3 — Propose, don't write yet

Present a diff-style preview grouped **by target file** (Global vs Project), then by section (Conventions & decisions / Anti-patterns & gotchas / Open threads). One tight sentence per item; tag each NEW vs MERGED. Then ask me to approve, edit, or skip.

### Step 4 — Apply after approval

Only after I approve, edit the target file(s):

- Add/merge entries under the right section; rewrite overlapping entries instead of duplicating.
- If this project has no `./retrospective.md` and project-level items exist, ask before creating one.
- Keep both files lean (rough rule: consolidate as a file approaches ~200 lines). The global file loads into every session, so be especially selective there.
- Do NOT accumulate knowledge in CLAUDE.md — it only points to the retrospectives.

Leave the actual git commit to me so I can review the diff myself.
