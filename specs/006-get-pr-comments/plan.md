# Implementation Plan: Get PR Open Comments

**Branch**: `006-get-pr-comments` | **Date**: 2026-03-31 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/006-get-pr-comments/spec.md`

## Summary

Add `automata git get-pr-comments` — a new subcommand that fetches unresolved review thread comments from GitHub for the current branch's pull request and prints them (human-readable or `--json`). Azure DevOps is not supported; the limitation is documented in `docs/azdo-gap.md`. Implementation follows the existing pattern in `src/commands/git.ts` and `src/git/gitService.ts`.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode), Node.js LTS
**Primary Dependencies**: commander.js (CLI), `gh` CLI via `spawnSync` (GitHub data), `node:child_process` (no execa)
**Storage**: N/A — read-only query
**Testing**: vitest
**Target Platform**: macOS / Linux / Windows (Node.js LTS)
**Project Type**: CLI tool
**Performance Goals**: Single `gh` CLI call; completes in <5 s on a standard connection
**Constraints**: No new runtime npm dependencies; reuse existing `run()` helper pattern
**Scale/Scope**: Single PR per invocation (current branch)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CLI-First Design — commander.js subcommand, `--json`, meaningful exit codes | ✓ Pass | New subcommand added to existing `gitCommand` |
| II. TypeScript Strictness — strict mode, no `any`, explicit return types | ✓ Pass | All new types will be explicit interfaces |
| III. Single Responsibility — one command does one thing | ✓ Pass | `get-pr-comments` only fetches unresolved threads |
| IV. npm Distribution — no extra build tools, bundled via tsup | ✓ Pass | No new dependencies introduced |
| V. Simplicity — no abstractions beyond what exists | ✓ Pass | Reuses existing `run()` helper and service layer pattern |

No violations. Complexity Tracking table not required.

## Project Structure

### Documentation (this feature)

```text
specs/006-get-pr-comments/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── contracts/           # Phase 1 output (CLI contract)
└── tasks.md             # Phase 2 output (not created by plan)
```

### Source Code (repository root)

```text
src/
├── commands/
│   └── git.ts           # Add getPrCommentsCmd; export via gitCommand
└── git/
    └── gitService.ts    # Add PrComment interface + getPrComments() function

tests/unit/
└── git.cmd.test.ts      # Add unit tests for getPrCommentsCmd

docs/
└── azdo-gap.md          # Add Gap #3: get-pr-comments unsupported in AzDO mode
```

**Structure Decision**: Single project (Option 1). Feature touches two existing files in the flat `src/` layout; no new directories needed.
