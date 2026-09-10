# Tasks: `--effort` on every AI-invoking command

**Branch**: `feature/032-ai-effort` | **Spec**: `specs/032-effort-option-all/spec.md` | **Plan**:
`specs/032-effort-option-all/plan.md`

`[P]` marks tasks that touch disjoint files and may run in parallel.

## Phase 1 — Executor argv (foundation, blocks everything else)

- [X] **T001** Add `effort?: string` to `InvokeClaudeOptions` and emit `--effort <level>` in `buildClaudeArgs`
  (`src/claude/claudeService.ts`). Thread `effort` through `invokeClaudeCode`, `invokeClaudeCodeSync`,
  `invokeClaudeCodeVerbose` and `runClaude`.
- [X] **T002** Add `effort?: string` to `InvokeCodexOptions` and emit `-c model_reasoning_effort="<level>"` in
  `buildCodexArgs` (`src/codex/codexService.ts`). Thread `effort` through `invokeCodexCode`, `invokeCodexCodeSync` and
  `runCodex`.
- [X] **T003 [P]** Tests for T001 in `tests/unit/claudeService.test.ts`: exact argv with effort, argv unchanged without
  it, and effort emitted alongside `--model`. (FR-002, FR-004)
- [X] **T004 [P]** Tests for T002 in `tests/unit/codexService.test.ts`: exact argv including the quoted TOML value,
  argv unchanged without it, and the flag position relative to `--model`. (FR-003, FR-004)

## Phase 2 — Config

- [X] **T005** Add the `DoWorkEffort` interface and `AutomataDoWorkConfig.effort` in `src/config/configStore.ts`, with
  the same "one shared field would be wrong" rationale `DoWorkModels` carries. (FR-005)
- [X] **T006** Add `config set do-work-effort <executor> <value>` in `src/commands/config.ts`, mirroring
  `do-work-model`: executor validated against `VALID_EXECUTORS`, empty value rejected, merged via `writeDoWork`.
  (FR-008)
- [X] **T007 [P]** Tests for T006 in `tests/unit/config.cmd.test.ts`: persists under `doWork.effort.<executor>`,
  preserves an existing entry for the other executor, rejects an unknown executor, rejects an empty value.
- [X] **T008** Wizard: `do-work-claude-effort` and `do-work-codex-effort` screens after their model screens, two state
  fields seeded from `existing.doWork?.effort`, and `effort` written in the Do Work save
  (`src/config/ConfigWizard.tsx`). (FR-009)
- [X] **T009** Update `tests/unit/ConfigWizard.test.tsx`: extend the full-chain walk with the two new screens and
  assert `effort` in the saved config; add a screen-reachability test for each.

## Phase 3 — Command surfaces

- [X] **T010** `do-work` (`src/commands/doWork.ts`): `--effort <level>` option, `Settings.effort`, resolution
  `options.effort ?? doWork.effort?.[executor]`, whitespace rejection,
  `validateSettingContainer(section["effort"], "effort", …)`, effort passed to both builders in `planRun`, appended to
  the dry-run `modelNote`, and `effort` added to the `--json` plan. (FR-001, FR-006, FR-007, FR-010, FR-011)
- [X] **T011 [P]** `execute` (`src/commands/execute.ts`): `--effort <level>` option passed to both executors. (FR-001)
- [X] **T012 [P]** `execute-prompt` (`src/commands/executePrompt.ts`): `--effort <level>` in `addAiOptions`, carried
  through `ExecutePromptAiOptions` into `invokeSelectedExecutor`, covering all three subcommands. (FR-001)
- [X] **T013 [P]** `implement-next` (`src/commands/getReady.ts`): `--effort <level>` option passed to both executors.
  (FR-001)
- [X] **T014 [P]** Tests for T010 in `tests/unit/doWork.cmd.test.ts`: `--effort` reaches the spawned argv; the config
  default applies; the flag beats the config; a `claude` entry does not apply to a `codex` run; a malformed
  `doWork.effort` fails validation; `--dry-run` prints the effort argument.
- [X] **T015 [P]** Tests for T011 in `tests/unit/execute.cmd.test.ts` (both executors).
- [X] **T016 [P]** Tests for T012 in `tests/unit/executePrompt.cmd.test.ts` (and the check-issue/fix-comments suites as
  needed).
- [X] **T017 [P]** Tests for T013 in `tests/unit/getReady.cmd.test.ts` (both executors).

## Phase 4 — Documentation

- [X] **T018 [P]** `docs/config.md`: document `doWork.effort` and `config set do-work-effort`, including the worked
  example from the issue.
- [X] **T019 [P]** `docs/do-work.md`: document `--effort`, the precedence chain, and the per-executor wiring.
- [X] **T020 [P]** `docs/execute.md`, `docs/execute-prompt.md`, `docs/implement-next.md`: document `--effort`.

## Phase 5 — Gate

- [X] **T021** `npm test && npm run lint` green (use `npx eslint src/` to read the real lint gate; see speckit memory).
- [X] **T022** Build (`npm run build`) and confirm `automata do-work --dry-run`-style argv construction by unit test.

## Traceability

| Requirement | Tasks |
|---|---|
| FR-001 | T010, T011, T012, T013 |
| FR-002 | T001, T003 |
| FR-003 | T002, T004 |
| FR-004 | T003, T004 |
| FR-005 | T005 |
| FR-006 | T010, T014 |
| FR-007 | T010, T014 |
| FR-008 | T006, T007 |
| FR-009 | T008, T009 |
| FR-010 | T010, T014 |
| FR-011 | T010, T014 |
| FR-012 | T001, T002 (no allow-list exists to test against; asserted by the pass-through argv tests) |
