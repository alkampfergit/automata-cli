# Tasks: Test Command Group

**Input**: Design documents from `/specs/008-test-command/`
**Prerequisites**: plan.md (required), spec.md (required), research.md

**Tests**: Unit tests included as this project already has vitest test coverage for all commands.

**Organization**: Single user story — tasks are sequential with parallel opportunities noted.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Extract shared service and prepare structure

- [X] T001 Create Claude service module extracting `resolveCommand` and `invokeClaudeCode` from src/commands/getReady.ts into src/services/claudeService.ts
- [X] T002 Update src/commands/getReady.ts to import `resolveCommand` and `invokeClaudeCode` from src/services/claudeService.ts

**Checkpoint**: Existing `implement-next` command still works after refactor

---

## Phase 2: User Story 1 - Test Claude Code Invocation (Priority: P1)

**Goal**: Provide `automata test claude --prompt <string> [--yolo]` to directly invoke Claude Code

**Independent Test**: Run `automata test claude --prompt "echo hello"` and verify Claude Code spawns correctly

### Tests for User Story 1

- [X] T003 [P] [US1] Create unit tests for claudeService in tests/unit/claudeService.test.ts
- [X] T004 [P] [US1] Create unit tests for test command in tests/unit/test.cmd.test.ts

### Implementation for User Story 1

- [X] T005 [US1] Create test command group with claude subcommand in src/commands/test.ts
- [X] T006 [US1] Register testCommand in src/index.ts
- [X] T007 [US1] Create documentation page at docs/test.md

**Checkpoint**: `automata test claude --prompt "hello"` works end-to-end

---

## Phase 3: Polish & Cross-Cutting Concerns

- [X] T008 Run `npm test && npm run lint` and fix any issues
- [X] T009 Verify existing getReady tests still pass after refactor

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: T001 → T002 (sequential — T002 depends on T001)
- **Phase 2 (User Story 1)**: Depends on Phase 1. T003 and T004 parallel. T005 depends on T001. T006 depends on T005. T007 parallel with T005/T006.
- **Phase 3 (Polish)**: Depends on all previous phases

### Parallel Opportunities

- T003 and T004 can run in parallel (different test files)
- T007 (docs) can run in parallel with T005/T006 (implementation)

---

## Implementation Strategy

### MVP (all tasks needed — small feature)

1. Extract shared service (T001-T002)
2. Write tests (T003-T004)
3. Implement command (T005-T006)
4. Document (T007)
5. Validate (T008-T009)

---

## Summary

- **Total tasks**: 9
- **User Story 1 tasks**: 5 (T003-T007)
- **Setup tasks**: 2 (T001-T002)
- **Polish tasks**: 2 (T008-T009)
- **Parallel opportunities**: T003/T004, T007 with T005/T006
