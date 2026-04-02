# Spec Decisions: implement-next Multi-Issue Selection

**Branch**: `013-implement-next-selection`
**Date**: 2026-04-02
**Spec**: [specs/013-implement-next-selection/spec.md](spec.md)
**Plan**: [specs/013-implement-next-selection/plan.md](plan.md)
**Research**: [specs/013-implement-next-selection/research.md](research.md)

## Planning Decisions

- **`listIssues` return type**: Changed from `GitHubIssue | null` to `GitHubIssue[]` with a `limit` parameter (default 10). **Rationale**: The caller needs the full list for selection; returning only the first item was a premature reduction. Empty array replaces the `null` sentinel. **Alternatives considered**: Adding a separate `listAllIssues` function — rejected to avoid duplicating the `gh issue list` call path.

- **Interactive prompt mechanism**: Node.js `readline` built-in. **Rationale**: Zero new runtime dependencies, consistent with project preference for Node.js built-ins (constitution principle V — simplicity). **Alternatives considered**: `inquirer` / `@inquirer/prompts` — rejected (adds runtime dep); `ink` (already in devDeps for wizard) — rejected (not a React rendering context; overkill for one prompt).

- **Issue ID in AI prompt**: Prepend `"Resolving issue #<number>:\n\n"` before the system prompt and issue body. **Rationale**: The AI sees the issue reference first, regardless of system prompt length. **Alternatives considered**: Append to end — rejected (AI models weight early context more); embed in system prompt — rejected (system prompt is user-configured and must not be mutated).

- **`--query-only` with multiple issues**: Display the numbered list and exit without prompting. **Rationale**: `--query-only` means read-only inspection; showing available options without claiming any is consistent with the flag's intent. No alternative considered.

- **Fetch exactly `limit` items**: When `issues.length === limit`, note "there may be more". **Rationale**: Simpler than fetching `limit + 1`; honest message without over-fetching. **Alternatives considered**: Fetch `limit + 1` to detect overflow exactly — rejected as unnecessary complexity.

- **Project structure**: Minimal targeted edits to two existing source files (`githubService.ts`, `getReady.ts`), one test file, one docs file. No new files in `src/`. **Rationale**: Consistent with constitution principle V (simplicity, flat module structure).
