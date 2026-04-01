# Implementation Plan: Config Prompt Files

**Branch**: `011-config-prompt-files` | **Date**: 2026-04-01 | **Spec**: [spec.md](./spec.md)

## Summary

Prompt-type config fields (`claudeSystemPrompt`, `prompts.sonar`, `prompts.fixComments`) currently store their text directly in `.automata/config.json`. This feature changes the convention so that when those field values end with `.md`, the tool reads the referenced file from `.automata/` instead of using the raw string. Existing inline strings continue to work unchanged. The config wizard is updated to automatically write prompt content to `.automata/<field>.md` files.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode)
**Primary Dependencies**: commander.js, ink + react (wizard), vitest (tests)
**Storage**: `.automata/config.json` (existing), `.automata/*.md` (new prompt files)
**Testing**: vitest
**Target Platform**: Node.js LTS (18+), Linux/macOS/Windows
**Project Type**: CLI tool
**Performance Goals**: File read is local filesystem — negligible overhead
**Constraints**: Must not break any existing inline-string config values
**Scale/Scope**: Small, targeted change to config reading and wizard save logic

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| CLI-First Design | PASS | No new commands; change is in existing config read/write paths |
| TypeScript Strictness | PASS | Will add typed helper with explicit return types; no `any` |
| Single Responsibility | PASS | New helper `resolvePromptRef()` has one job |
| npm Distribution | PASS | No new runtime dependencies |
| Simplicity (YAGNI) | PASS | Minimal change: one helper + small wizard update |

## Project Structure

### Documentation (this feature)

```text
specs/011-config-prompt-files/
├── plan.md           # This file
├── research.md       # Phase 0 output
├── data-model.md     # Phase 1 output
└── tasks.md          # Phase 2 output (speckit-tasks)
```

### Source Code Changes

```text
src/config/
├── configStore.ts    # Add resolvePromptRef(); update readConfig() to resolve prompt fields
└── ConfigWizard.tsx  # Update prompt-screen save handlers to write .md files

src/commands/
└── config.ts         # No change needed (set command stores value as-is; users may pass filename)

tests/ (new)
└── config/
    └── configStore.test.ts  # Unit tests for resolvePromptRef() and readConfig() resolution
```

## Complexity Tracking

No constitution violations. No complexity table needed.
