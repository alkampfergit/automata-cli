# Tasks: Unify implement-next AI options

**Input**: Design documents from `/specs/022-unify-ai-options/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)

---

## Phase 1: User Story 1 - Select AI executor via --with (Priority: P1)

**Goal**: Replace `--codex` boolean flag with `--with <executor>` option

**Independent Test**: Run `automata implement-next --help` and verify `--with` appears, `--codex` does not

### Tests for User Story 1

- [X] T001 [US1] Update CLI smoke test to check for `--with` instead of `--codex` in tests/unit/getReady.cmd.test.ts
- [X] T002 [US1] Update "invokes codex instead of claude" test to use `--with codex` instead of `--codex` in tests/unit/getReady.cmd.test.ts
- [X] T003 [US1] Add test for invalid `--with` value in tests/unit/getReady.cmd.test.ts
- [X] T004 [US1] Add test for default executor (no `--with` flag) in tests/unit/getReady.cmd.test.ts

### Implementation for User Story 1

- [X] T005 [US1] Replace `--codex` option with `--with <executor>` option (default: "claude") in src/commands/getReady.ts
- [X] T006 [US1] Add `--with` validation (must be "claude" or "codex") in the action handler in src/commands/getReady.ts
- [X] T007 [US1] Update executor selection logic to use `options.with` instead of `options.codex` in src/commands/getReady.ts
- [X] T008 [US1] Remove `resolveModelOption` import from src/commands/getReady.ts

**Checkpoint**: `--with claude` and `--with codex` work; `--codex` flag is removed

---

## Phase 2: User Story 2 - Select model via --model (Priority: P2)

**Goal**: Replace `--opus`, `--sonnet`, `--haiku` flags with `--model <string>`

**Independent Test**: Run `automata implement-next --model claude-sonnet-4-6` and verify model is passed through

### Tests for User Story 2

- [X] T009 [US2] Update CLI smoke test to check for `--model` and NOT `--opus`/`--sonnet`/`--haiku` in tests/unit/getReady.cmd.test.ts
- [X] T010 [US2] Add test verifying `--model` value is passed to Claude invocation in tests/unit/getReady.cmd.test.ts

### Implementation for User Story 2

- [X] T011 [US2] Remove `--opus`, `--sonnet`, `--haiku` options from command definition in src/commands/getReady.ts
- [X] T012 [US2] Add `--model <string>` option to command definition in src/commands/getReady.ts
- [X] T013 [US2] Update action handler to pass `options.model` directly instead of calling `resolveModelOption()` in src/commands/getReady.ts

**Checkpoint**: `--model` passes arbitrary model string to executor; shortcut flags removed

---

## Phase 3: User Story 3 - Replace --verbose with --silent (Priority: P3)

**Goal**: Replace `--verbose` opt-in with `--silent` opt-out to match execute command

**Independent Test**: Run `automata implement-next --help` and verify `--silent` appears, `--verbose` does not

### Tests for User Story 3

- [X] T014 [US3] Update CLI smoke test to check for `--silent` and NOT `--verbose` in tests/unit/getReady.cmd.test.ts
- [X] T015 [US3] Update Claude invocation tests to verify verbose is default (no `--silent`) in tests/unit/getReady.cmd.test.ts

### Implementation for User Story 3

- [X] T016 [US3] Replace `--verbose` option with `--silent` option in command definition in src/commands/getReady.ts
- [X] T017 [US3] Update action handler: pass `verbose: !options.silent` to invokeClaudeCode in src/commands/getReady.ts

**Checkpoint**: Verbose is default; `--silent` suppresses output

---

## Phase 4: Polish & Cross-Cutting Concerns

- [X] T018 Update options type definition to reflect new shape (remove codex/opus/sonnet/haiku/verbose, add with/model/silent) in src/commands/getReady.ts
- [X] T019 Update docs/implement-next.md with new options table and examples
- [X] T020 Run `npm test && npm run lint` and fix any failures

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (US1)**: No dependencies — can start immediately
- **Phase 2 (US2)**: Can run in parallel with Phase 1 (different option changes)
- **Phase 3 (US3)**: Can run in parallel with Phase 1 and 2 (different option changes)
- **Phase 4 (Polish)**: Depends on all user stories being complete

### Within Each Phase

- Tests SHOULD be written/updated before implementation
- All changes within a phase target the same file (src/commands/getReady.ts) so they run sequentially

### Parallel Opportunities

- T001, T009, T014 (smoke test updates) target the same file — must be sequential
- T019 (docs update) is independent and can run in parallel with implementation
- In practice, all phases modify the same files, so sequential execution is recommended

---

## Implementation Strategy

### Recommended: Sequential by Story

1. Complete Phase 1 (US1: --with flag) — core change
2. Complete Phase 2 (US2: --model flag) — model selection
3. Complete Phase 3 (US3: --silent flag) — output control
4. Complete Phase 4 (Polish) — docs and validation
5. Run `npm test && npm run lint` to confirm everything passes
