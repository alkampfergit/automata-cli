# Implementation Plan: GitHub Issue Discovery and Auto-Implementation (get-ready)

**Branch**: `003-gh-get-ready` | **Date**: 2026-03-30 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-gh-get-ready/spec.md`

## Summary

This feature adds a `get-ready` command to automata-cli that discovers the next open GitHub issue matching a configured filter (by label, assignee, or title substring), posts a "working" comment on it, and invokes Claude Code locally with the issue body as the prompt. It extends the existing `configStore` and `ConfigWizard` to support three new configuration fields, and wires the new command into the top-level CLI.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode), Node.js LTS
**Primary Dependencies**: commander.js (existing), ink + react (existing for wizard), spawnSync from node:child_process (existing pattern)
**Storage**: `.automata/config.json` (existing file, extended with new fields)
**Testing**: vitest (existing)
**Target Platform**: Linux/macOS CLI (same as existing tool)
**Project Type**: CLI tool
**Performance Goals**: Issue retrieval and comment posting under 10 seconds on broadband
**Constraints**: Must use `gh` CLI for GitHub operations; must use `claude` CLI for Claude Code invocation; no new runtime dependencies
**Scale/Scope**: Single-user local CLI; no concurrency concerns

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| CLI-First Design | PASS | New command follows commander.js pattern with --json and exit codes |
| TypeScript Strictness | PASS | All new code uses strict mode; no `any` |
| Single Responsibility | PASS | `get-ready` command is distinct from `git` subcommands; config is separated |
| npm Distribution | PASS | No new runtime dependencies; existing tsup bundler |
| Simplicity | PASS | Extends existing patterns (spawnSync, configStore, ConfigWizard) |

## Project Structure

### Documentation (this feature)

```text
specs/003-gh-get-ready/
├── plan.md              # This file
├── research.md          # Phase 0 decisions
├── data-model.md        # Config shape and GitHubIssue shape
├── tasks.md             # Task list
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
src/
├── commands/
│   ├── config.ts          # Extended with 3 new config set subcommands
│   ├── git.ts             # Unchanged
│   └── getReady.ts        # NEW: get-ready command
├── config/
│   ├── configStore.ts     # Extended: 3 new fields in AutomataConfig
│   ├── ConfigWizard.tsx   # Extended: GitHub-specific second screen
│   └── githubService.ts   # NEW: gh CLI wrappers (issue list, comment)
├── index.ts               # Extended: register getReadyCommand
└── version.ts             # Unchanged

tests/
└── unit/
    ├── configStore.test.ts     # Extended: new fields
    ├── githubService.test.ts   # NEW
    └── getReady.cmd.test.ts    # NEW
```

**Structure Decision**: Single project (existing). All new source files go under `src/` following the flat module structure mandated by the constitution. The `githubService.ts` module follows the same pattern as `gitService.ts` for external CLI wrappers.

## Complexity Tracking

No constitution violations. The feature extends existing patterns without introducing new abstractions.
