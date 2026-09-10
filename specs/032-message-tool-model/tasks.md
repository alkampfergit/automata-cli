# Tasks: Choose the executor and model from the triggering message

**Feature**: `feature/032-message-tool-model` | **Spec**: `specs/032-message-tool-model/spec.md`
| **Plan**: `specs/032-message-tool-model/plan.md`

`[P]` marks tasks that touch disjoint files and can run in parallel.

## Phase 1 — The pure rules (US1, US2)

- [X] **T001** Create `src/github/runDirective.ts` with the exported types from
  `contracts/runDirective.md`: `RunDirective`, `ExecutionSource`, `ResolvedExecution`,
  `ResolveExecutionResult`, `ResolveExecutionInput`, `VALID_TOOLS`.
- [X] **T002** Implement `parseRunDirective(body)` — the two lookbehind-guarded global
  regexes, last match wins, `tool` lower-cased, `model` case-preserved (FR-001…FR-005).
- [X] **T003** Implement `triggeringMessage(item)` — newest authorized new message across the
  surfaces the turn answers, per `plan.md` §Design (FR-001, spec Clarifications).
- [X] **T004** Implement `resolveExecution(input)` — both precedence tables from
  `data-model.md`, including the `--model` drop on an executor switch and the
  `{ ok: false, invalidTool }` branch (FR-006…FR-010).
- [X] **T005** Implement `describeExecution(execution)` — the one-line human rendering used
  by both the dry-run header and the tick summary (FR-014, FR-015).
- [X] **T006** Write `tests/unit/runDirective.test.ts` covering every row of the
  `parseRunDirective` table and both precedence tables, plus `triggeringMessage` for an
  issue turn, a pull-request turn, a thread-only turn and an issue-triggered build turn.

## Phase 2 — Wire it into `do-work` (US1, US2)

- [X] **T007** In `src/commands/doWork.ts`, add the baseline fields `withOption`,
  `modelOption`, `configExecutor` and `configModels` to `Settings` so per-item resolution has
  the inputs, and keep `executor` / `model` as the no-directive baseline for anything that
  still needs a tick-wide value.
- [X] **T008** Change `planRun`, `describePlannedRun` and `invokeExecutor` to take a
  `ResolvedExecution` parameter instead of reading `settings.executor` / `settings.model`.
- [X] **T009** In `processItem`, resolve the execution for the refreshed item before the
  prompt is composed, and pass it to `invokeExecutor`.
- [X] **T010** In `reportDryRun`, resolve per item and pass the result to `planRun` /
  `describePlannedRun` (FR-015).

## Phase 3 — Refuse an invalid `tool:` (US4)

- [X] **T011** In `processItem`, when `resolveExecution` returns `{ ok: false }`, update the
  marker with the explanation naming the invalid value and `claude` / `codex`, and return a
  `failed` `ItemReport` with no `ranExecutor` (FR-010, FR-011). Place it beside the existing
  oversized-prompt refusal so the marker already exists.
- [X] **T012** In `reportDryRun`, print the same refusal as the item header instead of a
  command, so a dry run shows the typo without invoking anything.

## Phase 4 — Reporting (US3)

- [X] **T013** Add `execution?: ResolvedExecution` to `ItemReport` and populate it wherever
  one was resolved.
- [X] **T014** Extend `summarize` to append `describeExecution(...)` to each item line
  (FR-014).
- [X] **T015** Extend the `--json` output — `executor`, `model`, `executorSource`,
  `modelSource` on each planned run and on each completed item (FR-016).

## Phase 5 — Tests and documentation

- [X] **T016** Extend `tests/unit/doWork.cmd.test.ts`: `tool:codex` routes to the Codex
  runner; `model:` reaches the argv; a directive in an older message is ignored;
  `tool:codexx` refuses with a marker update and invokes nothing; the refused item does not
  block a second item in the same tick.
- [X] **T017** [P] Document the directive in `docs/do-work.md` — a section under "Executor
  and model defaults", the updated precedence sentence, the new dry-run header line, the
  `failed` exit-code row, and the marker table.
- [X] **T018** Verify `README.md` needs no change (no installation, quick-start,
  command-group table or dev-setup change) — per the `AGENTS.md` documentation convention.
- [X] **T019** Run `npm test && npm run lint` (via `rtk proxy`, per repo memory) and fix any
  failure.

## Dependencies

```text
T001 → T002, T003, T004, T005 → T006
T004 → T007 → T008 → T009 → T011 → T013 → T014
T008 → T010 → T012
T013 → T015
T009,T011,T014,T015 → T016
T017 [P] with everything after T011
T016,T017,T018 → T019
```

## Definition of done

- Every functional requirement FR-001…FR-017 has at least one test.
- `npm test && npm run lint` are green.
- The pre-existing `doWork.cmd.test.ts` cases pass **unmodified** except for additions
  (SC-005).
