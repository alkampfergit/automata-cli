# Implementation Plan: Codex Flag for Implement-Next and Test Codex Command

**Branch**: `009-codex-flag-implement-next` | **Date**: 2026-03-31 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/009-codex-flag-implement-next/spec.md`

## Summary

Add a `--codex` flag to the `implement-next` command that routes AI invocation to the Codex CLI instead of Claude Code, using the same combined prompt (claudeSystemPrompt + issue body). Add a matching `test codex` subcommand mirroring `test claude`. Implement a `codexService.ts` module following the same pattern as `claudeService.ts` to handle Codex CLI invocation with `--yolo` (maps to `--dangerously-bypass-approvals-and-sandbox`) and `--verbose` support.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode)
**Primary Dependencies**: commander.js (existing), node:child_process (existing pattern)
**Storage**: N/A (no persistent data changes)
**Testing**: vitest (existing)
**Target Platform**: Node.js LTS (18+)
**Project Type**: CLI tool
**Performance Goals**: N/A — same as existing Claude invocation
**Constraints**: No new runtime dependencies; use Node.js built-ins only
**Scale/Scope**: 2 files modified (test.ts, getReady.ts), 1 new file (codexService.ts), 1 test file added

## Constitution Check

- [X] CLI-First Design: New `--codex` flag on existing command + new `test codex` subcommand
- [X] TypeScript Strictness: All new code uses strict TypeScript, explicit types
- [X] Single Responsibility: Codex invocation logic extracted to `codexService.ts` service module
- [X] npm Distribution: No new runtime dependencies
- [X] Simplicity: Follows exact same pattern as `claudeService.ts`; no abstractions beyond what already exists

No gate violations.

## Project Structure

### Documentation (this feature)

```text
specs/009-codex-flag-implement-next/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # N/A - no new data model
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```text
src/
├── claude/
│   └── claudeService.ts          # Existing — no changes needed
├── codex/
│   └── codexService.ts           # NEW — Codex CLI invocation service
└── commands/
    ├── getReady.ts               # MODIFIED — add --codex flag
    └── test.ts                   # MODIFIED — add test codex subcommand

src/__tests__/
└── codexService.test.ts          # NEW — unit tests for codexService
```

**Structure Decision**: Single project, flat service module under `src/codex/` to mirror the existing `src/claude/` pattern. No deeply nested directories.

## Complexity Tracking

No constitution violations.
