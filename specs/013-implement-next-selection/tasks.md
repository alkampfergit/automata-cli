# Tasks: implement-next Multi-Issue Selection

**Input**: Design documents from `specs/013-implement-next-selection/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅

---

## Phase 1: Foundational — Update `githubService.ts`

**Purpose**: Change `listIssues` to return multiple issues and accept a `limit` parameter. This change unblocks all user stories.

- [x] T001 [US1/US2/US3/US4/US5] Update `listIssues` in `src/config/githubService.ts`:
  - Change return type from `GitHubIssue | null` to `GitHubIssue[]`
  - Add `limit = 10` parameter
  - Replace hardcoded `"1"` in `--limit` arg with `String(limit)`
  - Replace `return issues[0]` / `return null` with `return issues`

**Checkpoint**: `githubService.ts` compiles. `listIssues` returns an array.

---

## Phase 2: User Stories 1 & 5 — Single-Issue Path + Issue ID in Prompt (Priority: P1)

**Goal**: When one issue is returned, print ID+title before implementing. Always embed issue number in AI prompt.

**Independent Test**: Mock single-issue `gh` response; verify `#<number>` and `<title>` appear in stdout; verify AI prompt starts with "Resolving issue #<number>".

- [x] T002 [US1/US5] Update `src/commands/getReady.ts` action handler:
  - Replace `listIssues(...)` call with updated signature (pass limit)
  - Handle empty array: output "No issues found..." and exit 0 (replaces `null` check)
  - When exactly one issue in array: print `Issue:  #N\nTitle:  <title>\nURL: ...` then full body (existing behaviour, but now explicitly triggered by array length === 1)
  - Change prompt assembly from `${systemPrompt}\n\n${issue.body}` to `Resolving issue #${issue.number}:\n\n${systemPrompt}\n\n${issue.body}`

- [x] T003 [US1/US5] Update tests in `tests/unit/getReady.cmd.test.ts`:
  - Update all existing mock `mockSpawnSync` returns for `gh issue list` to return arrays (they already do — verify)
  - Add test: single issue → stdout contains `#<number>` and title before AI invocation
  - Add test: AI prompt contains `Resolving issue #<number>`
  - Add test for Codex path: prompt contains issue number

**Checkpoint**: All existing tests pass. New single-issue tests pass.

---

## Phase 3: User Story 2 — Multi-Issue Interactive Selection (Priority: P1)

**Goal**: When multiple issues match, show numbered list and prompt user to select.

**Independent Test**: Mock 5-issue response; verify numbered list in stdout; simulate stdin input "2"; verify issue #2 is claimed and AI prompt mentions issue #2.

- [x] T004 [US2] Add interactive selection logic to `src/commands/getReady.ts`:
  - If `issues.length > 1` and no `--take-first` and no `--query-only`:
    - Print list: `  [N] #<number> - <title>` for each issue
    - If `issues.length === limit`: print `(Showing first ${limit} ready issues — there may be more. Use --limit to fetch more.)`
    - Prompt: `Select issue (1-${issues.length}): ` via `readline`
    - Validate input: must be integer in range [1, issues.length]; if invalid, stderr + exit 1
    - Set `issue = issues[selection - 1]`
    - Print selected issue ID + title
  - If `--query-only` and `issues.length > 1`: print list and exit 0 (no prompt)

- [x] T005 [US2] Add tests for multi-issue interactive selection in `tests/unit/getReady.cmd.test.ts`:
  - Mock 5 issues returned; mock `readline.createInterface` to return answer "2"; verify issue #2 prompt and AI invocation
  - Mock 10 issues (limit=10); verify "Showing first 10" message appears
  - Mock invalid input "0"; verify exit 1 + stderr error
  - Mock invalid input "abc"; verify exit 1 + stderr error
  - Mock `--query-only` with multiple issues; verify list is printed and no `gh issue comment` call

**Checkpoint**: Interactive selection tests pass. No regression on single-issue tests.

---

## Phase 4: User Story 3 — `--take-first` Flag (Priority: P2)

**Goal**: Skip interactive prompt, pick first issue, print ID+title, proceed.

**Independent Test**: Mock 3 issues; run with `--take-first`; verify no readline prompt, first issue selected, ID+title printed.

- [x] T006 [US3] Add `--take-first` option to `implementNextCommand` in `src/commands/getReady.ts`:
  - `.option("--take-first", "When multiple issues match, pick the first without prompting")`
  - In action: if `issues.length > 1` and `options.takeFirst`: print `Selecting issue #<number>: <title>` and set `issue = issues[0]`

- [x] T007 [US3] Add tests for `--take-first` in `tests/unit/getReady.cmd.test.ts`:
  - Mock 3 issues + `--take-first`; verify no readline call; verify stdout contains first issue ID + title
  - Mock 1 issue + `--take-first`; verify normal single-issue flow

**Checkpoint**: `--take-first` tests pass.

---

## Phase 5: User Story 4 — `--limit` Flag (Priority: P2)

**Goal**: Allow fetching more than 10 issues.

**Independent Test**: Mock with `--limit 20`; verify `gh issue list` is called with `--limit 20`.

- [x] T008 [US4] Add `--limit <n>` option to `implementNextCommand` in `src/commands/getReady.ts`:
  - `.option("--limit <n>", "Max issues to fetch and display (default: 10)", "10")`
  - Parse as integer; if ≤ 0 or NaN: stderr + exit 1
  - Pass parsed limit to `listIssues(..., limit)`

- [x] T009 [US4] Add tests for `--limit` in `tests/unit/getReady.cmd.test.ts`:
  - `--limit 20` → verify `gh issue list` called with `--limit` `"20"`
  - `--limit 0` → verify exit 1 + stderr validation error
  - `--limit abc` → verify exit 1 + stderr validation error

**Checkpoint**: `--limit` tests pass.

---

## Phase 6: Polish — Docs, CLI Help, Final Validation

- [x] T010 [P] Update `docs/implement-next.md`:
  - Add `--take-first` and `--limit <n>` to the Options table
  - Update Behaviour section to describe multi-issue list, interactive selection, and `--query-only` multi-issue behaviour
  - Add examples for `--take-first` and `--limit`

- [x] T011 Update CLI smoke test in `tests/unit/getReady.cmd.test.ts`:
  - Add assertions that `--help` output contains `--take-first` and `--limit`

- [x] T012 Run `npm test && npm run lint` and fix any failures

---

## Dependencies & Execution Order

- T001 (foundational) must complete before T002–T009
- T002 before T004 (selection logic builds on single-issue path)
- T006 can run in parallel with T004 (different conditional branches)
- T008 can run in parallel with T004/T006 (option parsing is independent)
- T010/T011 can run in parallel with T003–T009
- T012 must be last
