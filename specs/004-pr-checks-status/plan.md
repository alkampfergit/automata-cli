# Implementation Plan: PR Checks Status

**Branch**: `004-pr-checks-status` | **Date**: 2026-03-30 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/004-pr-checks-status/spec.md`

## Summary

Enhance `automata git get-pr-info` to fetch and display all CI/CD status checks from the pull request. Each check is shown with a pass/fail/pending indicator; failed checks also show their description text. The `--json` output is extended with a `checks` array. Implementation extends the existing `getPrInfo` function in `src/git/gitService.ts` to fetch `statusCheckRollup` from `gh pr view --json` and adds rendering logic in `src/commands/git.ts`.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode), Node.js LTS
**Primary Dependencies**: commander.js, gh CLI (external), node:child_process (built-in)
**Storage**: N/A
**Testing**: vitest
**Target Platform**: Node.js CLI on Linux/macOS
**Project Type**: CLI tool
**Performance Goals**: Single additional field added to existing `gh pr view --json` call; no additional subprocess
**Constraints**: Must not break existing `getPrInfo` return shape for `finish-feature` command; `--json` output must be backward-compatible (new `checks` field added)
**Scale/Scope**: Single command enhancement

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| CLI-First Design | PASS | Feature is a pure CLI command enhancement with `--json` support |
| TypeScript Strictness | PASS | All new types will be explicit interfaces; no `any` |
| Single Responsibility | PASS | `getPrInfo` extended minimally; rendering stays in command layer |
| npm Distribution | PASS | No new runtime dependencies |
| Simplicity | PASS | One extra JSON field added to existing `gh pr view` call |

All gates pass. Proceeding to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/004-pr-checks-status/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── git/
│   └── gitService.ts    # Add PrCheck interface; extend getPrInfo to fetch statusCheckRollup
└── commands/
    └── git.ts           # Add check rendering to get-pr-info human and JSON output

tests/
└── unit/
    └── git.cmd.test.ts  # Add unit tests for new check logic
```

**Structure Decision**: Single project, flat module structure. No new files needed — changes are confined to the two existing source files and the existing test file, consistent with the project's simplicity principle.
