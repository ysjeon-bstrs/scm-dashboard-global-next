---
description: Wrap up the current task — review the session, propose learnings, and update retrospective.md after approval
argument-hint: [optional focus, e.g. "auth refactor"]
allowed-tools: Read, Edit, Bash(git status:*), Bash(git diff:*), Bash(git log:*)
---

## Context

- Current git status: !`git status --short`
- Diff against HEAD: !`git diff --stat HEAD`
- Recent commits: !`git log --oneline -10`
- Existing retrospective: @retrospective.md

## Your task

You are wrapping up a unit of work before moving to the next task$ARGUMENTS.
Run a focused retrospective on THIS session. Do not just summarize — extract
what is worth carrying into future sessions.

### Step 1 — Analyze the session

Scan the conversation and the git changes above for:

- **Corrections** — places where I corrected you, or you redid work. These are
  the highest-value signals.
- **Conventions discovered** — project-specific patterns, commands, file
  layouts, or decisions that aren't obvious from the code alone.
- **Failures / dead ends** — approaches that looked right but were wrong, errors
  that cost time, gotchas. Record these as explicit anti-patterns.
- **Open threads** — anything left unfinished, pending, or deferred.

### Step 2 — Filter hard

Only keep items that are:

- **Project-specific** — not general coding knowledge you'd already know.
- **Durable** — likely to matter again in a future session, not one-off trivia.
- **Non-redundant** — check the existing retrospective.md above. If an entry
  already covers it, plan to UPDATE/MERGE that entry, not append a duplicate.

If nothing meets this bar, say so plainly and stop. An empty retrospective is
better than a noisy one.

### Step 3 — Propose, don't write yet

Present your proposed changes as a diff-style preview, grouped under the
retrospective.md sections:

- **Conventions & decisions** (add/update)
- **Anti-patterns / gotchas** (add/update)
- **Open threads** (the rolling "what's next" — replace stale items)

For each item, one tight sentence. Note explicitly which are NEW vs MERGED into
an existing entry. Then ask me to approve, edit, or skip.

### Step 4 — Apply after approval

Only after I approve, edit retrospective.md:

- Add new entries under the right section.
- Merge/rewrite overlapping entries instead of duplicating.
- Keep the file lean — if a section is getting long (rough rule: the file
  approaching ~200 lines), consolidate older entries rather than letting it grow
  unbounded.
- Do NOT touch CLAUDE.md — it only points here; it shouldn't accumulate content.

Leave the actual git commit to me so I can review the diff myself.
