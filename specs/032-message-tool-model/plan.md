# Implementation Plan: Choose the executor and model from the triggering message

**Branch**: `feature/032-message-tool-model` | **Date**: 2026-09-10 | **Spec**: `specs/032-message-tool-model/spec.md`

**Input**: Feature specification from `specs/032-message-tool-model/spec.md`

## Summary

Let an authorized maintainer steer one `do-work` turn from the text of the message that
triggers it: `tool:claude` / `tool:codex` selects the executor, `model:<id>` selects the
model. Both are read only from the newest authorized message the turn is answering, so the
choice never persists — the next tick re-reads whatever message is newest then.

The work splits cleanly in two. A new pure module, `src/github/runDirective.ts`, holds the
parsing (`parseRunDirective`), the pick-the-newest-trigger rule (`triggeringMessage`) and the
precedence chain (`resolveExecution`) — no I/O, no commander, no `gh`, so the whole rule set
is unit-testable the way `conversation.ts` and `workDetection.ts` already are. `doWork.ts`
then stops treating the executor and model as tick-wide `Settings` fields and resolves them
per work item, threading the result through `planRun`, `describePlannedRun`, `invokeExecutor`,
the JSON output and the tick summary. An unrecognised `tool:` value refuses the item at the
same pre-flight point as the existing oversized-prompt refusal — after the marker exists, so
the boundary advances and the mistyped message is explained once rather than refused forever.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode), Node.js 22.12+

**Primary Dependencies**: commander.js (existing); `src/claude/claudeService.ts` and
`src/codex/codexService.ts` (existing runners and argv builders); vitest. No new dependencies.

**Storage**: none. No new config key — the feature is a per-message override of the existing
`doWork.executor` / `doWork.models` keys.

**Testing**: vitest. Pure-rule tests in `tests/unit/runDirective.test.ts`; end-to-end command
behaviour in `tests/unit/doWork.cmd.test.ts` using its established mock-the-services pattern.

**Target Platform**: Node.js CLI running unattended from cron in a disposable container.

**Performance Goals**: none beyond "no additional API calls" — the directive is parsed from
message bodies the tick has already fetched.

**Constraints**: no behaviour change for a message without a directive (the existing suite
must pass unmodified); `implement-next` untouched; the new module must not import commander,
`gh` or `git`; no new runtime dependency.

**Scale/Scope**: one new pure module, one command refactor (tick-wide → per-item execution
settings), two test files, one docs page update.

## Constitution Check

*GATE: passed before Phase 0, re-checked after Phase 1.*

| Principle | Assessment |
|---|---|
| **I. CLI-First Design** | No new command or option. Existing `--json` output is extended, not replaced; exit codes keep their documented meanings (a refused item is `failed` → exit 2). ✅ |
| **II. TypeScript Strictness** | No `any`. The directive is a discriminated shape with explicit exported types (`RunDirective`, `ResolvedExecution`, `ExecutionSource`). ✅ |
| **III. Single Responsibility** | The parsing and precedence rules go in a new pure module rather than inline in the command, matching the existing `conversation.ts` / `workDetection.ts` split. No logic is duplicated: `resolveExecution` becomes the single place the executor/model chain is evaluated, replacing the inline chain in `resolveSettings`. ✅ |
| **IV. npm Distribution** | No dependency, no build change. ✅ |
| **V. Simplicity** | One module, three exported functions, no abstraction over the two executors beyond the `Executor` union that already exists. No config key added. ✅ |

No violations; the Complexity Tracking table is omitted.

## Project Structure

### Documentation (this feature)

```text
specs/032-message-tool-model/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 decisions
├── data-model.md        # Phase 1 types
├── quickstart.md        # Phase 1 usage walkthrough
├── contracts/
│   └── runDirective.md  # Exported surface of the new module
├── pr-report.md         # Reviewer-facing summary
├── spec-decisions.md    # Planning decisions
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```text
src/
├── github/
│   ├── conversation.ts      # unchanged — supplies RawMessage / SurfaceAnalysis
│   ├── workDetection.ts     # unchanged — supplies WorkItem
│   └── runDirective.ts      # NEW: parse, pick the trigger, resolve precedence
└── commands/
    └── doWork.ts            # CHANGED: per-item execution settings

tests/unit/
├── runDirective.test.ts     # NEW: pure-rule coverage
└── doWork.cmd.test.ts       # CHANGED: directive end-to-end cases

docs/
└── do-work.md               # CHANGED: directive reference
```

**Structure Decision**: the existing flat `src/<area>/` layout is kept. `runDirective.ts`
sits beside `conversation.ts` and `workDetection.ts` in `src/github/` because it consumes
`RawMessage` and `WorkItem` and, like them, is pure — even though the directive itself is
remote-agnostic. Putting it in `src/commands/` would make it untestable without commander,
and a new top-level directory for one 120-line module would violate Principle V.

## Design

### The three rules, in order

1. **`triggeringMessage(item)`** — collect every message the turn is answering and return the
   newest by `createdAt`:
   - `issue-discuss`: `item.issueAnalysis.newMessages`.
   - `pr-work`: `item.prAnalysis.newMessages`, plus the authorized comments of
     `item.actionableThreads` that are newer than `item.prAnalysis.lastAgentAt`, plus
     `item.issueAnalysis.newMessages` (a build turn can be triggered by an issue message
     alone).

   Ties break towards the last element in that order, which is stable and irrelevant in
   practice — two authorized messages in the same second is not a case worth ranking.

2. **`parseRunDirective(body)`** — two global, case-insensitive regexes with a
   `(?<![A-Za-z0-9_:-])` guard so `mytool:` and `no-tool:` are inert. Take the **last** match
   of each. Returns `{ tool, model }` where `tool` is the lower-cased value (which
   may be invalid — validation is the caller's job) and `model` keeps its original case.

3. **`resolveExecution({ directive, withOption, modelOption, configExecutor, configModels,
   defaultExecutor })`**
   — returns either `{ ok: true, executor, executorSource, model, modelSource }` or
   `{ ok: false, invalidTool }`. The `--with` value is validated by the caller before it gets
   here, as it is today.

### Where it plugs into `doWork.ts`

`Settings` keeps the *baseline* resolution (what `--with` / `--model` / config say), and a new
per-item `ResolvedExecution` is computed in `processItem` and in `reportDryRun`. Everything
downstream that reads `settings.executor` / `settings.model` — `planRun`,
`describePlannedRun`, `invokeExecutor`, `toRunJson` — takes the resolved value as a parameter
instead. The invalid-tool refusal reuses the exact shape of the oversized-prompt refusal:
`updateMarker(...)` with an explanation, `progress(...)`, and a `failed` `ItemReport` with no
`ranExecutor`, so the run cap is not consumed.

## Complexity Tracking

Not applicable — the Constitution Check found no violations.
