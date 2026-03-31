# Tasks: Get PR Open Comments

**Input**: Design documents from `/specs/006-get-pr-comments/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: No new project structure needed; feature is additive to existing files.

- [ ] T001 Verify `gh pr view --json reviewThreads` returns expected shape on a real repo (manual smoke test — confirms the data contract before coding)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Add the `PrComment` interface and `getPrComments()` service function; both user stories depend on this.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T002 Add `PrComment` interface (fields: `author`, `body`, `path`, `line`, `createdAt`) to `src/git/gitService.ts`
- [ ] T003 Add internal `RawReviewThread` and `RawReviewThreadComment` interfaces to `src/git/gitService.ts`
- [ ] T004 Implement `getPrComments(branch: string): PrComment[] | null` in `src/git/gitService.ts`:
  - GitHub path: call `gh pr view <branch> --json reviewThreads`, filter `isResolved === false`, map first comment of each thread
  - AzDO path: return `"unsupported"` sentinel (handled by command layer)
  - `null` return when no PR found (mirrors `getPrInfo` pattern)

**Checkpoint**: Service function ready — command implementation can proceed.

---

## Phase 3: User Story 1 — List Unresolved Review Comments (Priority: P1) 🎯 MVP

**Goal**: `automata git get-pr-comments` prints unresolved review threads in a human-readable format.

**Independent Test**: Run `automata git get-pr-comments` on a branch with an open PR that has unresolved threads — confirm output shows author, path:line, and body for each thread.

### Implementation for User Story 1

- [ ] T005 [US1] Add `getPrCommentsCmd` to `src/commands/git.ts`:
  - Wire `getCurrentBranch()` and `getPrComments(branch)`
  - AzDO guard: if `remoteType === "azdo"`, write error to stderr and exit 1
  - No PR found: write error to stderr and exit 1
  - Human-readable output: `[author] on path:line\nbody\n` per thread, blank line between threads
  - If no unresolved threads: print `No open comments.\n` and exit 0
- [ ] T006 [US1] Register `getPrCommentsCmd` in `gitCommand.addCommand(...)` in `src/commands/git.ts`
- [ ] T007 [P] [US1] Add unit tests for `getPrCommentsCmd` in `tests/unit/git.cmd.test.ts`:
  - Test: PR with 2 unresolved threads prints correct human-readable output
  - Test: PR with no unresolved threads prints "No open comments."
  - Test: No PR found exits with code 1
  - Test: AzDO remote type exits with code 1 and correct error message

**Checkpoint**: US1 complete — `automata git get-pr-comments` is fully functional and tested.

---

## Phase 4: User Story 2 — JSON Output (Priority: P2)

**Goal**: `automata git get-pr-comments --json` emits a JSON array of unresolved thread entries.

**Independent Test**: Run `automata git get-pr-comments --json` and pipe to `jq` — confirm output is a valid JSON array with `author`, `body`, `path`, `line`, `createdAt` fields.

### Implementation for User Story 2

- [ ] T008 [US2] Add `--json` option to `getPrCommentsCmd` in `src/commands/git.ts`:
  - When `--json` flag set: output `JSON.stringify(comments, null, 2)` to stdout
  - Empty case: output `[]`
- [ ] T009 [P] [US2] Add unit tests for `--json` flag in `tests/unit/git.cmd.test.ts`:
  - Test: `--json` with unresolved threads outputs parseable JSON array with correct fields
  - Test: `--json` with no unresolved threads outputs `[]`

**Checkpoint**: US1 + US2 both functional and tested.

---

## Phase 5: Polish & Cross-Cutting Concerns

- [ ] T010 [P] Add Gap #3 entry to `docs/azdo-gap.md` documenting that `get-pr-comments` is unavailable in AzDO mode (explain what azdo-cli lacks and what would close the gap)
- [ ] T011 [P] Update `docs/git.md` with `get-pr-comments` command reference (signature, options, output examples, exit codes)
- [ ] T012 Update the `Supported in AzDO Mode` table in `docs/azdo-gap.md` to confirm `get-pr-comments` is GitHub-only
- [ ] T013 Run `npm test && npm run lint` and fix any failures

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS Phase 3 and Phase 4
- **Phase 3 (US1)**: Depends on Phase 2
- **Phase 4 (US2)**: Depends on Phase 3 (adds `--json` to the same command)
- **Phase 5 (Polish)**: Depends on Phase 4

### Within Each Phase

- T002 → T003 → T004 (interfaces before implementation)
- T005 → T006 (command created before registered)
- T007 can run in parallel with T005/T006 once T004 is done

### Parallel Opportunities

- T007 (unit tests) and T005/T006 (implementation) can be written in parallel once foundational types exist
- T009, T010, T011 can all run in parallel after T008 is complete

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 2: Foundational (T002–T004)
2. Complete Phase 3: US1 (T005–T007)
3. **STOP and VALIDATE**: run `npm test && node dist/index.js git get-pr-comments --help`
4. Proceed to US2 and Polish

### Incremental Delivery

1. Phase 2 → Phase 3: human-readable output working and tested
2. Phase 4: add `--json` flag
3. Phase 5: docs + gap entry

---

## Notes

- No new npm dependencies required
- All new types must use explicit TypeScript interfaces (no `any`)
- Exit codes: 0 for success, 1 for any error (matches existing `get-pr-info` pattern)
- Commit after Phase 3 checkpoint and again after Phase 5
