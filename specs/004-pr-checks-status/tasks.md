# Tasks: PR Checks Status

**Input**: Design documents from `/specs/004-pr-checks-status/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

---

## Phase 1: Setup

**Purpose**: No new project setup needed — changes confined to existing files.

- [X] T001 Verify existing tests pass before starting: `npm test`

---

## Phase 2: Foundational

**Purpose**: Add the `PrCheck` interface and extend `PrInfo` in `src/git/gitService.ts` — required before any user story work.

- [X] T002 Add `PrCheck` interface and extend `PrInfo` with optional `checks?: PrCheck[]` field in `src/git/gitService.ts`
- [X] T003 Extend `getPrInfo` to fetch `statusCheckRollup` field by adding it to the `--json` field list in the `gh pr view` call in `src/git/gitService.ts`, and map the raw response to `PrCheck[]` on the returned `PrInfo`

**Checkpoint**: Foundation ready — `getPrInfo` now returns check data; user story work can begin.

---

## Phase 3: User Story 1 — View All Checks with Pass/Fail Status (Priority: P1) MVP

**Goal**: `automata git get-pr-info` lists all checks with ✓/✗/● symbol indicators.

**Independent Test**: Run `automata git get-pr-info` against a real or mocked PR; verify each check is printed with the correct symbol.

### Implementation for User Story 1

- [X] T004 [US1] Add `formatChecks` helper in `src/commands/git.ts` that renders the checks list with ✓ (SUCCESS), ✗ (FAILURE/TIMED_OUT/ACTION_REQUIRED/CANCELLED), ● (IN_PROGRESS/QUEUED), ○ (SKIPPED/NEUTRAL) symbols
- [X] T005 [US1] Update the human-readable output block in `get-pr-info` command action in `src/commands/git.ts` to append the `Checks:` section (or `Checks: none`) after the existing PR metadata lines

**Checkpoint**: User Story 1 complete — check list with pass/fail indicators is visible in terminal output.

---

## Phase 4: User Story 2 — View Failure Details for Failed Checks (Priority: P2)

**Goal**: Failed checks display their `description` text (or "(no details available)") on the next indented line.

**Independent Test**: Mock a PR with a failed check having a non-empty `description`; verify the detail text appears in the output.

### Implementation for User Story 2

- [X] T006 [US2] Extend `formatChecks` helper in `src/commands/git.ts` to print the `description` field (indented, prefixed with `Details:`) beneath each ✗ check; print `(no details available)` when `description` is empty

**Checkpoint**: User Story 2 complete — failure details are shown inline under each failed check.

---

## Phase 5: User Story 3 — JSON Output Includes Checks Data (Priority: P3)

**Goal**: `automata git get-pr-info --json` output contains a `checks` array with full check data.

**Independent Test**: Run `automata git get-pr-info --json`; parse JSON and assert `checks` array exists with correct fields.

### Implementation for User Story 3

- [X] T007 [US3] Verify that the `--json` branch in the `get-pr-info` action in `src/commands/git.ts` serialises the full `PrInfo` object (including `checks`) — no changes needed if `JSON.stringify(pr)` already covers it; add `checks: []` default on `PrInfo` if `checks` may be undefined to guarantee the field is always present in JSON output

**Checkpoint**: User Story 3 complete — JSON output always contains `checks` array.

---

## Phase 6: Polish & Tests

**Purpose**: Unit tests covering new logic; ensures regressions are caught.

- [X] T008 [P] Add unit tests for `getPrInfo` in `tests/unit/git.cmd.test.ts`: mock `gh pr view` returning `statusCheckRollup` data and assert that `pr.checks` is correctly populated
- [X] T009 [P] Add unit tests for check rendering in `tests/unit/git.cmd.test.ts`: assert correct symbols and failure details for various check states (SUCCESS, FAILURE with description, FAILURE without description, IN_PROGRESS)
- [X] T010 Rebuild dist and run full test suite: `npm test && npm run lint`

---

## Dependencies & Execution Order

- **Phase 1** → no dependencies
- **Phase 2** → depends on Phase 1 (T002, T003 sequential)
- **Phase 3** → depends on Phase 2 (T004 then T005)
- **Phase 4** → depends on Phase 3 (T006 extends T004)
- **Phase 5** → depends on Phase 2 (T007 verifies JSON path)
- **Phase 6** → depends on all phases (T008, T009 parallel; T010 final)

---

## Implementation Strategy

### MVP (User Stories 1 + 2)

1. Phase 1: Verify baseline
2. Phase 2: Extend types and `getPrInfo`
3. Phase 3: Show checks with symbols
4. Phase 4: Add failure details
5. Phase 6: Tests + lint

### Incremental Delivery

- US1 → basic check list (immediately useful)
- US2 → failure details (diagnostic value)
- US3 → JSON (scripting/automation value)
