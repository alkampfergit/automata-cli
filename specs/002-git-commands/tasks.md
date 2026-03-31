# Tasks: Git Workflow Commands

**Input**: Design documents from `/specs/002-git-commands/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 = get-pr-info, US2 = finish-feature

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the git service module and git command group skeleton

- [X] T001 Create `src/git/gitService.ts` with typed subprocess helpers for `git` and `gh` commands
- [X] T002 Create `src/commands/git.ts` with the `git` command group scaffold (commander.js Command)
- [X] T003 Register `gitCommand` in `src/index.ts` alongside existing `configCommand`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The `gitService.ts` shell execution infrastructure must exist before either command can be implemented

**⚠️ CRITICAL**: Both user stories depend on Phase 1 completion

**Checkpoint**: `src/git/gitService.ts` exports typed functions; `src/commands/git.ts` registers a `git` subcommand that shows help when run with no sub-subcommand.

---

## Phase 3: User Story 1 - Get PR Info (Priority: P1) 🎯 MVP

**Goal**: `automata git get-pr-info` queries `gh` for the PR on the current branch and prints it

**Independent Test**: Run `automata git get-pr-info` on a branch with an open PR — output contains PR number, title, state, URL. Run on a branch without a PR — friendly message, exit 0.

### Implementation for User Story 1

- [X] T00X [US1] Add `getCurrentBranch(): string` to `src/git/gitService.ts` using `git rev-parse --abbrev-ref HEAD`
- [X] T00X [US1] Add `getPrInfo(branch: string): PrInfo | null` to `src/git/gitService.ts` using `gh pr view --json number,title,state,url`
- [X] T00X [US1] Define `PrInfo` interface in `src/git/gitService.ts` (fields: number, title, state, url)
- [X] T00X [US1] Implement `get-pr-info` subcommand in `src/commands/git.ts` with `--json` flag support
- [X] T00X [US1] Add human-readable output formatting for `get-pr-info` (key-value lines: `PR:`, `Title:`, `State:`, `URL:`)
- [X] T00X [US1] Add JSON output path for `get-pr-info` (serialize `PrInfo` to stdout when `--json` passed)
- [X] T01X [US1] Handle error cases in `get-pr-info`: `gh` not installed, not authenticated, repo has no remote
- [X] T01X [P] [US1] Write unit tests for `get-pr-info` in `tests/unit/git.cmd.test.ts` using `vi.mock` on `src/git/gitService.ts`

**Checkpoint**: `automata git get-pr-info` works end-to-end in human-readable and JSON modes.

---

## Phase 4: User Story 2 - Finish Feature (Priority: P2)

**Goal**: `automata git finish-feature` validates preconditions then cleans up the local branch

**Independent Test**: Run `automata git finish-feature` on a branch whose PR is merged and upstream is gone — verify checkout develop, pull, and branch deletion occur.

### Implementation for User Story 2

- [X] T01X [US2] Add `isUpstreamGone(branch: string): boolean` to `src/git/gitService.ts` using `git ls-remote --exit-code --heads origin <branch>`
- [X] T01X [US2] Add `hasUncommittedChanges(): boolean` to `src/git/gitService.ts` using `git status --porcelain`
- [X] T01X [US2] Add `checkoutAndPull(targetBranch: string): void` to `src/git/gitService.ts` running `git checkout` then `git pull`
- [X] T01X [US2] Add `deleteLocalBranch(branch: string): void` to `src/git/gitService.ts` using `git branch -d`
- [X] T01X [US2] Implement `finish-feature` subcommand in `src/commands/git.ts` with full precondition validation sequence:
  - abort if current branch is `develop`
  - abort if uncommitted changes exist
  - abort if no PR found for branch
  - abort if PR state is not `merged`
  - abort if upstream tracking branch still exists
  - proceed: checkout develop, pull, delete local branch
- [X] T01X [P] [US2] Write unit tests for `finish-feature` in `tests/unit/git.cmd.test.ts` covering all precondition failure paths and the happy path

**Checkpoint**: `automata git finish-feature` correctly validates all preconditions and performs cleanup.

---

## Phase 5: Polish & Cross-Cutting Concerns

- [X] T01X [P] Run `npm test && npm run lint` — fix any type errors or lint warnings
- [X] T01X Update `README.md` to document the `git get-pr-info` and `git finish-feature` commands with usage examples
- [X] T02X Commit all work with descriptive messages

---

## Dependencies & Execution Order

- **Phase 1 (T001-T003)**: No dependencies — start immediately
- **Phase 2**: Implicit checkpoint; no separate tasks
- **Phase 3 (T004-T011)**: Depends on Phase 1 completion
- **Phase 4 (T012-T017)**: Depends on Phase 1 completion; T012-T015 can start in parallel with T004-T009
- **Phase 5 (T018-T020)**: Depends on all Phase 3 and Phase 4 tasks complete

### Parallel Opportunities

- T011 (US1 unit tests) can be written in parallel with T007-T010 (they mock the service layer)
- T012-T015 (US2 service functions) are independent files — can be parallelized
- T017 (US2 unit tests) can be written alongside T016

---

## Implementation Strategy

### MVP (User Story 1 Only)

1. Complete T001-T003 (setup)
2. Complete T004-T011 (US1 implementation + tests)
3. Validate: `automata git get-pr-info` works
4. Then proceed to US2

### Notes

- Use `spawnSync` from `node:child_process` (not `execSync`) for subprocess calls
- All service functions must return typed values; no `any`
- Error output always goes to `process.stderr`; success output to `process.stdout`
- Exit codes: 0 for success, 1 for expected errors, non-zero for unexpected failures
