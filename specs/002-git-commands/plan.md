# Implementation Plan: Git Workflow Commands

**Branch**: `002-git-commands` | **Date**: 2026-03-30 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-git-commands/spec.md`

## Summary

Add a `git` subcommand group to automata-cli exposing two commands: `get-pr-info` (queries GitHub via `gh` CLI for an open/merged PR on the current branch) and `finish-feature` (validates the PR is merged and upstream is gone, then checkouts `develop`, pulls, and deletes the local branch). Both commands shell out to `git` and `gh`; no direct GitHub API calls are made.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode), Node.js LTS
**Primary Dependencies**: commander.js (CLI framework), `node:child_process` (exec git/gh), `execa` (optional, already not present — use `execSync`/`spawnSync` from Node.js built-ins)
**Storage**: N/A (no persistent data; reads git state and calls `gh` CLI)
**Testing**: vitest (unit tests using spies/mocks for child_process)
**Target Platform**: Linux/macOS CLI (Node.js)
**Project Type**: CLI tool
**Performance Goals**: Commands complete within 3 seconds under normal network conditions
**Constraints**: Must not introduce new runtime npm dependencies beyond what is already in package.json; shell out to `git` and `gh` only
**Scale/Scope**: Two focused commands

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CLI-First Design | PASS | Commands added as commander.js subcommands with `--json` flag on `get-pr-info` |
| II. TypeScript Strictness | PASS | All modules use strict mode; no `any` |
| III. Single Responsibility | PASS | Each command does exactly one thing |
| IV. npm Distribution | PASS | No new runtime dependencies needed; uses Node.js built-ins |
| V. Simplicity | PASS | Shell out to `git`/`gh`; no SDK wrappers |

No violations.

## Phase 0: Research

### Decision: How to invoke `gh` and `git`

- **Decision**: Use `spawnSync` from `node:child_process` for subprocess invocations. It is synchronous (appropriate for a CLI), returns structured `{ stdout, stderr, status }`, and requires no additional dependencies.
- **Rationale**: `execSync` is simpler for capturing output but throws on non-zero exit codes making error handling awkward. `spawnSync` gives explicit exit code access without throwing.
- **Alternatives considered**: `execa` (third-party, cleaner API but adds a dependency — rejected per Constitution IV); `execSync` (simpler but exception-based error flow).

### Decision: How to detect if the current branch has a PR

- **Decision**: Run `gh pr view --json number,title,state,url` with no branch argument — `gh` automatically uses the current branch. Parse the JSON output.
- **Rationale**: The `gh` CLI handles auth, repo detection, and API calls. Querying current branch PR is the intended use of `gh pr view` without a branch argument.
- **Alternatives considered**: Raw GitHub REST API (requires auth token management, more code — rejected per Constitution V); `gh pr list --head <branch>` (works but `gh pr view` is more direct).

### Decision: How to detect if upstream tracking branch is gone

- **Decision**: Run `git ls-remote --exit-code --heads origin <branch>` — exits with code 2 if the ref is not found. This is explicit and reliable without parsing `git branch -vv`.
- **Rationale**: `git ls-remote` queries the actual remote in real-time, avoiding stale local tracking ref state. Exit code 2 is documented for "no match found".
- **Alternatives considered**: `git branch -vv | grep '[gone]'` (fragile string parsing of localized output — rejected); `git remote show origin` (much heavier, parses large output — rejected).

### Decision: Module structure for git commands

- **Decision**: Create `src/commands/git.ts` as the git command group, with service functions in `src/git/gitService.ts` (wraps `spawnSync` calls to `git` and `gh`).
- **Rationale**: Mirrors the existing `src/commands/config.ts` pattern. Service layer makes unit testing possible via module mocking without spawning real processes.
- **Alternatives considered**: Inline all logic in the command file (harder to test — rejected); separate file per command (over-engineering for 2 related commands — rejected).

### Autonomous Decisions

- [AUTO] No new runtime npm dependencies: use `node:child_process` built-in — per Constitution IV (minimal dependencies).
- [AUTO] Service layer for `git`/`gh` calls lives in `src/git/gitService.ts` — follows existing `src/config/configStore.ts` pattern.
- [AUTO] Unit tests mock the service layer functions via vitest `vi.mock`, not the subprocess calls — consistent with existing test pattern in `tests/unit/configStore.test.ts`.

## Project Structure

### Documentation (this feature)

```text
specs/002-git-commands/
├── plan.md              # This file
├── research.md          # (merged into plan.md — see Phase 0 above)
├── tasks.md             # Phase 2 output
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
src/
├── commands/
│   ├── config.ts        # existing
│   └── git.ts           # NEW: git command group (get-pr-info, finish-feature)
├── git/
│   └── gitService.ts    # NEW: service functions wrapping git/gh subprocess calls
├── index.ts             # modified: register gitCommand
├── config/              # existing, unchanged
└── version.ts           # existing, unchanged

tests/
└── unit/
    ├── cli.test.ts          # existing
    ├── configStore.test.ts  # existing
    ├── config.cmd.test.ts   # existing
    └── git.cmd.test.ts      # NEW: unit tests for git commands
```

## Complexity Tracking

No constitution violations. No complexity tracking required.
