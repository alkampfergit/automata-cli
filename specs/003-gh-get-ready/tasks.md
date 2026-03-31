# Tasks: GitHub Issue Discovery and Auto-Implementation (get-ready)

**Input**: Design documents from `/specs/003-gh-get-ready/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: No new infrastructure needed — all existing. This phase confirms build and test pass before changes.

- [x] T001 Verify `npm test && npm run lint` passes on current codebase (baseline check)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Extend configStore with new types and fields; all user stories depend on this.

- [x] T002 Add `IssueDiscoveryTechnique` type alias and three new optional fields (`issueDiscoveryTechnique`, `issueDiscoveryValue`, `claudeSystemPrompt`) to `AutomataConfig` interface in `src/config/configStore.ts`
- [x] T003 [P] Add `configStore` unit tests for new fields (read/write round-trip) in `tests/unit/configStore.test.ts`

**Checkpoint**: configStore extended and tested — user story implementation can begin.

---

## Phase 3: User Story 1 - Configure GitHub Issue Discovery (Priority: P1) MVP

**Goal**: Extend config wizard and `config set` subcommands so developers can configure issue discovery technique, value, and Claude system prompt.

**Independent Test**: Run `automata config set issue-discovery-technique label` and `automata config set issue-discovery-value "ready-for-dev"`, then verify `.automata/config.json` contains the expected values. Also run `automata config` and verify the wizard shows GitHub-specific fields after selecting "GitHub" as remote type.

### Implementation for User Story 1

- [x] T004 [US1] Add `automata config set issue-discovery-technique <value>` subcommand to `src/commands/config.ts` (validate against allowed values: label, assignee, title-contains)
- [x] T005 [US1] Add `automata config set issue-discovery-value <value>` subcommand to `src/commands/config.ts`
- [x] T006 [US1] Add `automata config set claude-system-prompt <value>` subcommand to `src/commands/config.ts`
- [x] T007 [US1] Extend `ConfigWizard.tsx` in `src/config/ConfigWizard.tsx` to show a second screen for `issueDiscoveryTechnique`, `issueDiscoveryValue`, and `claudeSystemPrompt` when `remoteType` is `"gh"`
- [x] T008 [P] [US1] Add CLI smoke tests for the three new `config set` subcommands in `tests/unit/config.cmd.test.ts`

**Checkpoint**: User Story 1 fully functional — developers can configure all three new fields.

---

## Phase 4: User Story 2 - Retrieve Next Issue (Priority: P2)

**Goal**: Implement the `get-ready` command that validates config, queries GitHub for matching open issues, prints the first match, and posts a "working" comment.

**Independent Test**: Mock `gh` CLI calls; run `automata get-ready` with a mocked GitHub response and verify: correct issue printed, comment posted, correct error when `remoteType` is `"azdo"`, correct error when no technique configured, graceful message when no issues found.

### Implementation for User Story 2

- [x] T009 [US2] Create `src/config/githubService.ts` with functions: `listIssues(technique, value): GitHubIssue | null` and `postComment(issueNumber: number, body: string): void`
- [x] T010 [P] [US2] Add unit tests for `githubService.ts` in `tests/unit/githubService.test.ts` (mock spawnSync; test all three techniques, comment posting, no-issues-found, gh-not-installed error cases)
- [x] T011 [US2] Create `src/commands/getReady.ts` with `getReadyCommand` that:
  1. Reads config and errors if `remoteType !== "gh"`
  2. Errors if `issueDiscoveryTechnique` not set
  3. Calls `listIssues()` from githubService
  4. Prints issue details (or JSON with `--json`)
  5. Calls `postComment()` with "working"
  6. Exits 0 with message if no issue found
- [x] T012 [US2] Register `getReadyCommand` in `src/index.ts`
- [x] T013 [P] [US2] Add CLI smoke test for `automata get-ready --help` in `tests/unit/getReady.cmd.test.ts`

**Checkpoint**: User Story 2 fully functional — developers can run `get-ready` to claim an issue.

---

## Phase 5: User Story 3 - Invoke Claude Code on Issue (Priority: P3)

**Goal**: After retrieving the issue and posting the comment, `get-ready` invokes Claude Code with the system prompt and issue body.

**Independent Test**: Mock Claude Code invocation; verify correct arguments passed (system prompt + body, or body only when no system prompt). Verify `--no-claude` skips invocation. Verify non-zero exit from `claude` is surfaced.

### Implementation for User Story 3

- [x] T014 [US3] Extend `src/commands/getReady.ts` to invoke Claude Code after posting comment:
  - Build prompt: `"${claudeSystemPrompt}\n\n${issue.body}"` (or just `issue.body` if no system prompt)
  - Spawn `claude -p "<prompt>"` using spawnSync
  - Skip if `--no-claude` flag is passed
  - Surface exit code and stderr if Claude Code fails
- [x] T015 [P] [US3] Add unit tests for Claude Code invocation logic in `tests/unit/getReady.cmd.test.ts` (mock spawnSync for `claude` binary; verify argument construction for both with/without system prompt, `--no-claude` flag, error surfacing)

**Checkpoint**: All three user stories complete and independently testable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and consistency checks.

- [x] T016 Run `npm test && npm run lint` and fix any failures
- [x] T017 [P] Verify `automata --help` shows `get-ready` command
- [x] T018 [P] Verify `automata get-ready --help` shows `--json` and `--no-claude` flags

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies
- **Phase 2 (Foundational)**: Depends on Phase 1
- **Phase 3 (US1)**: Depends on Phase 2
- **Phase 4 (US2)**: Depends on Phase 2 and Phase 3 (needs configStore extended)
- **Phase 5 (US3)**: Depends on Phase 4 (needs getReady.ts base)
- **Phase 6 (Polish)**: Depends on all previous phases

### User Story Dependencies

- **US1**: Can complete after Foundational
- **US2**: Depends on US1 config fields being available
- **US3**: Extends US2's getReady.ts

### Parallel Opportunities

- T003 (configStore tests) and T002 (implementation) can run together
- T008 (config cmd tests) can run alongside T004–T007
- T010 (githubService tests) alongside T009 (implementation)
- T013 (smoke test) alongside T011–T012
- T015 (Claude invocation tests) alongside T014

---

## Implementation Strategy

### MVP (User Story 1 + 2 only)

1. Phase 1: Verify baseline
2. Phase 2: Extend configStore
3. Phase 3: Add config set subcommands and wizard extension
4. Phase 4: Implement `get-ready` with issue retrieval and comment posting
5. STOP and validate: run `automata get-ready` with a real GitHub repo

### Full Feature

Add Phase 5 for Claude Code invocation after MVP validated.
