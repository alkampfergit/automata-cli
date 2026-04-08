---
name: "speckit-memory"
description: "Capture stable lessons from a speckit run into persistent project memory and create/update helper skills when repeated repo-specific workflows emerge."
compatibility: "Requires spec-kit project structure with .specify/ directory"
metadata:
  author: "automata-cli"
---

## User Input

```text
$ARGUMENTS
```

Use any user-provided notes as additional context, but do not require them.

## Goal

Persist reusable lessons from the current `speckit-full` execution so the next run starts with better repo-specific context and less friction.

Write durable memory to `.specify/memory/speckit-memory.md`. Create or update a helper skill under `.agents/skills/` only when a repeated repo-specific workflow is stable enough to deserve its own instructions.

## What Belongs In Memory

Record only information that is likely to help future runs:

1. Stable project defaults repeatedly chosen during autonomous execution
2. Repo-specific implementation patterns that beat generic defaults
3. Process friction and the reliable way around it
4. Reviewer or documentation expectations that should influence future runs
5. Reusable multi-step workflows that are better captured as helper skills

Do **not** record:

1. Feature-specific business requirements
2. Temporary branch names, PR URLs, or one-off timestamps
3. File-by-file implementation diaries
4. Incidents that are unlikely to recur
5. Anything contradicted by current code, `AGENTS.md`, or `.specify/memory/constitution.md`

## Outline

1. Resolve the active feature with `.specify/scripts/bash/check-prerequisites.sh --json --paths-only`.
2. Read only the artifacts needed to extract durable lessons:
   - `.specify/memory/constitution.md`
   - `AGENTS.md`
   - Existing `.specify/memory/speckit-memory.md` if present
   - Active feature `spec.md`, `plan.md`, `tasks.md`
   - `research.md`, `pr-report.md`, and `spec-decisions.md` if present
   - The current diff or completed-task state when useful to confirm what actually worked
3. Extract candidate lessons and classify each one:
   - `keep`: stable and reusable
   - `promote`: stable enough for a helper skill
   - `drop`: too specific, stale, or noisy
4. If `.specify/memory/speckit-memory.md` does not exist, create it from `.specify/templates/speckit-memory-template.md`.
5. Update the memory file by section:
   - `## Autonomous Defaults`
   - `## Implementation Patterns`
   - `## Process Friction`
   - `## Helper Skills`
6. Use concise bullets in this format:

   ```markdown
   - **<topic>**: <rule or preferred action>. Why: <short rationale>. Confirmed: <YYYY-MM-DD>.
   ```

7. De-duplicate semantically similar bullets, refresh the `Confirmed` date for surviving entries, and remove entries that are now contradicted.
8. Keep the file lean:
   - Prefer updating an existing bullet over adding a near-duplicate
   - Keep each section short and high-signal
   - If a section grows noisy, collapse repeated details into one stronger rule

## Helper Skill Promotion Rule

Create or update a helper skill only if **all** of the following are true:

1. The workflow is likely to recur across multiple features
2. It contains at least three ordered steps, branching rules, or tool-specific gotchas
3. A short bullet in memory would be insufficient guidance
4. The workflow can be described without feature-specific product details

When promoting:

1. Create or update `.agents/skills/<skill-name>/SKILL.md`
2. Keep the helper skill narrow and procedural
3. Reference `.specify/memory/speckit-memory.md` only when needed; do not copy large memory sections into the skill
4. Add or refresh a matching bullet in the memory file's `## Helper Skills` section

If a candidate workflow does not meet the bar, keep it as a memory bullet instead of creating a new skill.

## Output

Report:

1. Memory file path
2. Bullets added, updated, or removed
3. Helper skills created or updated
4. Any candidate lessons intentionally discarded as too specific
