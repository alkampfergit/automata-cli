# Implementation Plan: implement-next Multi-Issue Selection

**Branch**: `013-implement-next-selection` | **Date**: 2026-04-02 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/013-implement-next-selection/spec.md`

## Summary

Enhance `automata implement-next` so that when multiple GitHub issues match the configured filter the user is presented with a numbered list (default 10, configurable via `--limit`) and can choose which issue to work on. Add `--take-first` for non-interactive selection. Always print the issue ID and title before AI invocation, and always include the issue number in the prompt passed to Claude or Codex.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode)  
**Primary Dependencies**: commander.js (CLI), Node.js `readline` (interactive prompt), `gh` CLI (GitHub data)  
**Storage**: N/A — read-only query, no persistent state changes  
**Testing**: vitest + spawnSync mock  
**Target Platform**: Node.js LTS (18+), cross-platform CLI  
**Project Type**: CLI tool  
**Performance Goals**: N/A (interactive selection latency dominated by user input)  
**Constraints**: No new npm dependencies; Node.js built-ins only  
**Scale/Scope**: Small — two modified files (`githubService.ts`, `getReady.ts`), one updated test file, one updated docs file

## Constitution Check

- [x] **CLI-First**: All changes are commander.js options (`--take-first`, `--limit`). POSIX output conventions maintained.
- [x] **TypeScript Strictness**: No `any` usage. `listIssues` return type changes from `GitHubIssue | null` to `GitHubIssue[]`. All types explicit.
- [x] **Single Responsibility**: `githubService.listIssues` handles fetching; `getReady.ts` handles selection logic and AI invocation. No mixing.
- [x] **No new runtime dependencies**: `readline` is a Node.js built-in.
- [x] **Simplicity (YAGNI)**: No pagination, no fuzzy search — just numbered list + readline input.

## Project Structure

### Documentation (this feature)

```text
specs/013-implement-next-selection/
├── spec.md
├── plan.md              (this file)
├── research.md
├── checklists/
│   └── requirements.md
└── tasks.md             (Phase 4 output)
```

### Source Code (repository root)

```text
src/
├── commands/
│   └── getReady.ts          (modified: add --take-first, --limit, selection logic, issue ID in prompt)
└── config/
    └── githubService.ts     (modified: listIssues returns GitHubIssue[], accepts limit param)

tests/unit/
└── getReady.cmd.test.ts     (modified: extend with multi-issue selection tests)

docs/
└── implement-next.md        (modified: document new options and behaviour)
```

**Structure Decision**: Single project layout — flat module structure. No new files needed; all changes are targeted edits to existing files.

## Decisions

### Decision 1: Return type of `listIssues`

**Chosen approach**: Change `listIssues(technique, value, limit)` to return `GitHubIssue[]` (empty array for no results, array of up to `limit` items otherwise).

**Rationale**: The caller (`getReady.ts`) needs the full list to present a selection menu. Returning the first item was a premature reduction. The empty-array sentinel replaces the `null` sentinel — no nullable unwrapping needed.

**Alternatives considered**:
- Keep `listIssues` returning `GitHubIssue | null` and add a separate `listAllIssues` function — rejected because it duplicates the `gh issue list` call path and violates DRY.

### Decision 2: Interactive prompt mechanism

**Chosen approach**: Use Node.js `readline.createInterface` with `process.stdin`/`process.stdout`.

**Rationale**: Zero new dependencies. Readline is the canonical Node.js built-in for line-oriented user input. The existing codebase uses `spawnSync` (built-ins preferred), consistent with constitution principle V.

**Alternatives considered**:
- `inquirer` or `@inquirer/prompts` — rejected because they add a runtime dependency for a single prompt.
- `ink` (already in devDeps) — rejected because this command is not a React rendering context; adding Ink for a single selection adds unnecessary complexity.

### Decision 3: Issue ID in AI prompt

**Chosen approach**: Prepend `"Resolving issue #<number>:\n\n"` to the assembled prompt string (before system prompt + body).

**Rationale**: The issue number should be the first thing the AI sees. Prepending it guarantees visibility regardless of how long the system prompt is.

**Alternatives considered**:
- Append to the end — rejected because AI models pay more attention to early context.
- Embed in the system prompt — rejected because the system prompt is user-configured and we should not mutate it.

### Decision 4: `--query-only` with multiple issues

**Chosen approach**: When `--query-only` is set and multiple issues match, display the numbered list and exit — no interactive prompt, no selection.

**Rationale**: `--query-only` means "show me what's available and exit". Displaying the list without prompting is consistent with the flag's intent of read-only inspection.
