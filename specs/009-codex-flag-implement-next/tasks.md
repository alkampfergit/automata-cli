# Tasks: Codex Flag for Implement-Next and Test Codex Command

**Input**: Design documents from `/specs/009-codex-flag-implement-next/`
**Prerequisites**: plan.md, spec.md, research.md

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to
- Exact file paths included in descriptions

---

## Phase 1: Setup (No new project setup needed)

**Purpose**: This feature extends existing files — no new project scaffolding required. The `src/codex/` directory is the only new directory.

- [ ] T001 Create directory `src/codex/` for the new Codex service module

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Implement the core Codex service module. Both user stories depend on this.

- [ ] T002 Create `src/codex/codexService.ts` with `InvokeCodexOptions` interface, `resolveCommand` reuse (import from claudeService or inline), `invokeCodexCode`, `invokeCodexCodeSync`, and `invokeCodexCodeVerbose` functions — modeled directly after `src/claude/claudeService.ts`

**Checkpoint**: codexService.ts compiles and exports the public API.

---

## Phase 3: User Story 1 - Use Codex for Issue Implementation (Priority: P1) - MVP

**Goal**: Add `--codex` flag to `implement-next` that routes invocation to Codex CLI.

**Independent Test**: Run `automata implement-next --codex` with a mocked codex binary on PATH and verify the correct invocation arguments are passed.

### Implementation for User Story 1

- [ ] T003 [US1] Add `--codex` flag option to `implementNextCommand` in `src/commands/getReady.ts`, update the options type to include `codex?: boolean`
- [ ] T004 [US1] In `src/commands/getReady.ts`, import `invokeCodexCode` from `../codex/codexService.js` and add conditional branch: if `options.codex` is true, invoke Codex; else fall through to existing Claude invocation
- [ ] T005 [US1] Write unit tests in `src/__tests__/codexService.test.ts` covering: sync invocation builds correct args, yolo flag appends `--dangerously-bypass-approvals-and-sandbox`, ENOENT produces correct error message

**Checkpoint**: `automata implement-next --codex` correctly invokes the Codex CLI.

---

## Phase 4: User Story 2 - Test Codex Subcommand (Priority: P2)

**Goal**: Add `test codex` subcommand to the existing `test` command group.

**Independent Test**: Run `automata test codex --prompt "hello"` and verify the Codex CLI is invoked with the correct arguments.

### Implementation for User Story 2

- [ ] T006 [US2] In `src/commands/test.ts`, add a `testCodexCmd` Command mirroring `testClaudeCmd`, with `--prompt`, `--yolo`, `--verbose` options, importing `invokeCodexCode` from `../codex/codexService.js`
- [ ] T007 [US2] Register `testCodexCmd` with `.addCommand(testCodexCmd)` on `testCommand` in `src/commands/test.ts`

**Checkpoint**: `automata test codex --prompt "hello"` correctly invokes the Codex CLI.

---

## Phase 5: Polish & Cross-Cutting Concerns

- [ ] T008 [P] Update `docs/implement-next.md` to document `--codex`, `--yolo` (Codex semantics), and `--verbose` flags for Codex usage
- [ ] T009 [P] Update `docs/test.md` to document the new `test codex` subcommand with its options and examples

---

## Dependencies & Execution Order

- **Phase 1**: No dependencies — start immediately
- **Phase 2** (T002): Depends on Phase 1 (T001 — directory creation)
- **Phase 3** (T003–T005): Depends on Phase 2 (T002 — codexService.ts exists)
- **Phase 4** (T006–T007): Depends on Phase 2 (T002 — codexService.ts exists); can run in parallel with Phase 3
- **Phase 5** (T008–T009): Depends on Phases 3 and 4 complete

### Parallel Opportunities

- T003 and T006 can run in parallel (different files: getReady.ts vs test.ts)
- T008 and T009 can run in parallel (different files: docs/implement-next.md vs docs/test.md)

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001: Create codex/ directory
2. T002: Implement codexService.ts
3. T003–T005: Add --codex to implement-next + tests
4. Validate: `automata implement-next --codex` works

### Incremental Delivery

1. T001 + T002: Foundation ready
2. T003–T005: implement-next --codex works (MVP)
3. T006–T007: test codex works
4. T008–T009: Docs updated
