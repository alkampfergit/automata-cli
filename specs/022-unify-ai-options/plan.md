# Implementation Plan: Unify implement-next AI options

**Branch**: `022-unify-ai-options` | **Date**: 2026-04-08 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/022-unify-ai-options/spec.md`

## Summary

Replace the `--codex`, `--opus`, `--sonnet`, `--haiku`, and `--verbose` flags in the `implement-next` command with `--with <executor>`, `--model <string>`, and `--silent` options, matching the `execute` command's interface pattern.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode)  
**Primary Dependencies**: commander.js, node:child_process  
**Storage**: N/A  
**Testing**: vitest  
**Target Platform**: Node.js LTS (18+)  
**Project Type**: CLI  
**Performance Goals**: N/A (refactor, no performance-sensitive changes)  
**Constraints**: Must maintain compatibility with existing `--no-claude`, `--yolo`, `--json`, `--take-first`, `--limit`, `--query-only` flags  
**Scale/Scope**: 3 files changed (command, tests, docs)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CLI-First Design | PASS | New options follow POSIX conventions; `--with` takes a value, `--model` takes a string |
| II. TypeScript Strictness | PASS | All types will be explicit; no `any` usage |
| III. Single Responsibility | PASS | No new commands; modifying existing options only |
| IV. npm Distribution | PASS | No new dependencies |
| V. Simplicity | PASS | Removing complexity (4 model flags → 1 generic `--model`; `--codex` → `--with`) |

## Project Structure

### Documentation (this feature)

```text
specs/022-unify-ai-options/
├── spec.md
├── plan.md
├── research.md
├── tasks.md
├── pr-report.md
├── spec-decisions.md
└── checklists/
    └── requirements.md
```

### Source Code (modified files)

```text
src/
├── commands/
│   └── getReady.ts          # Main command file — replace options
├── claude/
│   └── claudeService.ts     # Retains resolveModelOption for executePrompt consumers
└── codex/
    └── codexService.ts      # No changes

tests/
└── unit/
    └── getReady.cmd.test.ts # Update tests for new options

docs/
└── implement-next.md        # Update documentation
```

**Structure Decision**: Modify existing files only. `getReady.ts` will stop using `resolveModelOption`, but `claudeService.ts` must retain `resolveModelOption` and `MODEL_IDS` because `executePrompt.ts` still depends on them.

## Complexity Tracking

No violations. This is a simplification refactor removing 4 flags and adding 2.
