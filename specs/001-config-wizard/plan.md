# Implementation Plan: Config Wizard

**Branch**: `001-config-wizard` | **Date**: 2026-03-30 | **Spec**: [specs/001-config-wizard/spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-config-wizard/spec.md`

## Summary

Add a `config` command to the automata CLI that provides two modes: (1) an interactive wizard using the `ink` npm package to let users select the remote environment type (GitHub or Azure DevOps) via a terminal UI, and (2) a non-interactive `automata config set type <gh|azdo>` subcommand for scripted use. Configuration is persisted as JSON to `.automata/config.json` in the current working directory.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode), Node.js LTS
**Primary Dependencies**: commander.js (existing), ink (new), react (peer dep for ink), @inkjs/ui (optional list selector)
**Storage**: Local file system — `.automata/config.json`
**Testing**: vitest (existing)
**Target Platform**: Linux/macOS/Windows terminal (TTY)
**Project Type**: CLI tool
**Performance Goals**: `config set` completes in <1s; wizard interaction latency imperceptible
**Constraints**: Must not break existing commander.js setup; ink requires React peer dependency; ESM-compatible build via tsup
**Scale/Scope**: Single config key (`remoteType`) for this feature

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| CLI-First Design | PASS | Commands exposed via commander.js; stdin/stdout/stderr used correctly |
| TypeScript Strictness | PASS | strict mode; no `any`; explicit types required |
| Single Responsibility | PASS | `config` command owns config concerns only |
| npm Distribution | PASS | tsup bundles all; ink will be a runtime dependency in `package.json` |
| Simplicity | PASS | Minimal ink component; no unnecessary abstractions |

**No violations.** No Complexity Tracking needed.

## Project Structure

### Documentation (this feature)

```text
specs/001-config-wizard/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── cli-contract.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── index.ts            # Register 'config' command (existing entry point)
├── version.ts          # Existing
├── config/
│   ├── configStore.ts  # Read/write .automata/config.json
│   └── ConfigWizard.tsx # ink React component for interactive wizard
└── commands/
    └── config.ts       # commander.js command definition

tests/
└── unit/
    ├── cli.test.ts         # Existing
    ├── configStore.test.ts # Unit tests for config read/write
    └── config.cmd.test.ts  # Unit tests for config set command
```

**Structure Decision**: Single project with a flat `src/config/` module for the new feature. Commander command registration stays in `src/commands/config.ts` and is wired in `src/index.ts`. Ink component lives in `src/config/ConfigWizard.tsx`.

## Autonomous Decisions

- **Decision**: Use `ink` directly (not `@inkjs/ui`) for the list selector.
  **Rationale**: `ink` alone provides sufficient primitives; `@inkjs/ui` adds weight with minimal gain for a two-option selector.
  **Alternatives considered**: `@inkjs/ui` Select component — rejected to keep dependencies minimal per Simplicity principle.

- **Decision**: Store config in `.automata/config.json` relative to `process.cwd()`.
  **Rationale**: Project-level config follows the convention of local hidden folders (`.git`, `.vscode`).
  **Alternatives considered**: `~/.automata/config.json` (global) — rejected because the tool manages agents per-project.

- **Decision**: React + ink as runtime dependencies (not devDependencies).
  **Rationale**: ink renders at runtime in the user's terminal; it cannot be tree-shaken.
  **Alternatives considered**: devDependency + bundling — tsup can bundle but ink's dynamic terminal rendering requires it at runtime.
