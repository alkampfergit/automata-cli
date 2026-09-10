# Implementation Plan: `--effort` on every AI-invoking command

**Branch**: `feature/032-ai-effort` | **Date**: 2026-09-10 | **Spec**: `specs/032-effort-option-all/spec.md`

**Input**: Feature specification from `specs/032-effort-option-all/spec.md`

## Summary

Add a reasoning-effort control to automata. One new optional field on each executor's invoke-options interface
(`effort?: string`) is turned into argv inside the two existing argument builders — `--effort <level>` for `claude`,
`-c model_reasoning_effort="<level>"` for `codex`, which has no dedicated flag. That option is then threaded from a new
`--effort <level>` on all six AI-invoking command surfaces, and, for `do-work` alone, from a new `doWork.effort`
config object keyed per executor that mirrors `doWork.models` exactly. No new modules, no new dependencies: the whole
change is one field carried along the paths `model` already travels.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode), Node.js 22.12+ to run, Node 24 LTS in CI

**Primary Dependencies**: commander.js; ink + react (existing wizard); vitest. None added.

**Storage**: `.automata/config.json`, extended with `doWork.effort`

**Testing**: vitest unit tests — argv assertions on the two builders, option-plumbing assertions per command, config
validation and persistence tests, wizard navigation tests

**Target Platform**: Node.js CLI

**Performance Goals**: N/A — no new process spawns or network calls

**Constraints**: no new runtime dependencies; no behaviour change when the option is absent (FR-004/SC-003); the dry
run must stay identical to the real spawn; existing wizard navigation tests that use `advanceTo(...)` must keep passing

**Scale/Scope**: two service files, four command files, one config module, one wizard, five doc pages, and unit tests

## Constitution Check

| Principle | Compliance |
|---|---|
| I. CLI-First Design | `--effort <level>` is a commander option on every surface; the value reaches the executor and nothing else. `do-work --json` reports the resolved effort so the JSON output stays a complete description of the run. Invalid input exits non-zero on stderr. |
| II. TypeScript Strictness | `effort?: string` on the two existing option interfaces and on `Settings`; no `any`; the executor key is the existing `Executor` union, so `doWork.effort[executor]` is checked. |
| III. Single Responsibility | No new command. The argv construction lives in the two builders that already own it, rather than being duplicated at five call sites — the no-duplication rule is the reason for this placement. |
| IV. npm Distribution | No dependency, no build change. |
| V. Simplicity | One optional string threaded along an existing path; no new abstraction, no validation layer, no new module. `doWork.effort` reuses `validateSettingContainer` and `writeDoWork` unchanged. |

No deviations; no Complexity Tracking entry required.

## Project Structure

No new files in `src/`. Changed files:

```
src/
├── claude/claudeService.ts      # InvokeClaudeOptions.effort; emit --effort; thread through runClaude + both invoke paths
├── codex/codexService.ts        # InvokeCodexOptions.effort; emit -c model_reasoning_effort="…"; thread through runCodex
├── config/configStore.ts        # DoWorkEffort interface; AutomataDoWorkConfig.effort
├── config/ConfigWizard.tsx      # two screens, two state fields, persistence in the Do Work save
└── commands/
    ├── doWork.ts                # --effort option, Settings.effort, resolution + precedence, validation, dry-run + --json
    ├── execute.ts               # --effort option → both executors
    ├── executePrompt.ts         # --effort in addAiOptions → invokeSelectedExecutor
    └── getReady.ts              # --effort option on implement-next → both executors

tests/unit/                      # claudeService, codexService, configStore, config.cmd, ConfigWizard,
                                 # doWork.cmd, execute.cmd, executePrompt.cmd, getReady.cmd

docs/                            # config.md, do-work.md, execute.md, execute-prompt.md, implement-next.md
```

**Structure Decision**: keep the existing flat layout. This feature adds no logic that could live in a pure module —
the only computation is a two-branch string-to-argv mapping that belongs beside the flag it is a sibling of. Adding a
module for it would be the indirection principle V forbids.

## Design

### Argument building

```ts
// claudeService.ts
export interface InvokeClaudeOptions { yolo?: boolean; verbose?: boolean; model?: string; effort?: string }
// in buildClaudeArgs, after the model flag:
if (options.effort) args.push("--effort", options.effort);

// codexService.ts
export interface InvokeCodexOptions { yolo?: boolean; verbose?: boolean; model?: string; effort?: string }
// in buildCodexArgs, after the model flag:
if (options.effort) args.push("-c", `model_reasoning_effort="${options.effort}"`);
```

The truthiness check gives FR-004 and FR-011 together: `undefined` and `""` both emit nothing, so an empty value can
never reach the executor even if a caller skips the CLI-level check.

### Precedence

`do-work` resolves once in `resolveSettings`, next to the existing model line:

```ts
effort: options.effort ?? doWork.effort?.[executor],
```

The other five commands have no configured default, so the option value is passed straight through.

### Validation

- CLI: a shared `resolveEffortOption(value)` rejects a whitespace-only value with exit 1. `do-work` uses its own
  `fail(...)` helper for message consistency with its other option errors.
- Config: `validateSettingContainer(section["effort"], "effort", ["claude", "codex"])` — the same call
  `models` already makes, giving FR-007 for one line.

### Dry run and JSON

`planRun` passes `effort: settings.effort` into whichever builder it calls, so the printed command is the real argv.
`describePlannedRun`'s `modelNote` gains ` · effort <level>` when set, and the `--json` plan gains
`effort: settings.effort ?? null` beside `model`.

## Phases

**Phase 0 — Research**: complete, see `research.md`. The two executors' flag syntaxes were verified against the
installed binaries, not assumed.

**Phase 1 — Contracts**: no new public interfaces beyond the three additive optional fields above. No contract
directory: this feature exposes no new module boundary.

**Phase 2 — Tasks**: see `tasks.md`.

## Risks

- **The codex `-c` value quoting**: `-c` parses the value as TOML, so the level must be quoted. An unquoted value
  happens to work today for bare words (codex falls back to a literal string) but not for anything else; quoting is
  correct in both cases. Covered by an exact-argv unit test.
- **Wizard test coupling**: the one Do Work test that walks the chain key-by-key must gain two entries. All other Do
  Work tests navigate with `advanceTo(...)` and are unaffected.
