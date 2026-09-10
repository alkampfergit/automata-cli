# Tasks: Manage orphaned pull requests in `do-work`

**Branch**: `feature/033-orphan-pull-requests` | **Spec**: `specs/033-orphan-pull-requests/spec.md` |
**Plan**: `specs/033-orphan-pull-requests/plan.md`

`[P]` marks tasks that touch disjoint files and may run in parallel.

## Phase 1 — Turn kind and prompt (foundation, blocks everything else)

- [X] **T001** Add `"pr-orphan"` to `TurnKind` and `prOrphan?: string` to `DoWorkPrompts`; export
  `DEFAULT_DO_WORK_PR_ORPHAN_PROMPT`; resolve `config.doWork.prompts.prOrphan` through
  `resolvePromptRef` in `readConfig` (`src/config/configStore.ts`). (FR-006)
- [X] **T002 [P]** Test in `tests/unit/configStore.test.ts`: `prOrphan: "pr-orphan.md"` resolves from
  `.automata/`, and a path escaping `.automata/` throws. (FR-006)

## Phase 2 — Orphan discovery

- [X] **T003** Extend `LINK_MAP_QUERY` with `labels(first:50){nodes{name}}` and
  `assignees(first:50){nodes{login}}`; add the `OrphanPr` interface; add `orphans: OrphanPr[]` to
  `OpenPrLinkMap` and fill it in `getOpenPrLinkMap` with every open pull request whose
  `closingIssuesReferences` contains no issue of this repository
  (`src/github/ghWorkService.ts`). (FR-001, FR-018, SC-003)
- [X] **T004** Test in `tests/unit/ghWorkService.test.ts`: a pull request closing nothing is an
  orphan; one closing an issue of this repository is not; one closing only another repository's
  issue is; labels and assignees are normalised to string arrays; orphans are collected across
  pages. (FR-001, FR-002, FR-018)

## Phase 3 — The orphan decision (pure logic)

- [X] **T005** In `src/github/workDetection.ts`: make `WorkItem.issue` `GitHubIssue | null`; add
  `pr: PullRequestRef | null` and allow `issue: null` on the `skip` variant of `Decision`; add
  `"pr-closed"` and `"pr-linked"` to `SkipReason`; let `unsafeBranchSkip` take a nullable issue.
  (FR-005, FR-014)
- [X] **T006** Add `OrphanPrState` and `decideOrphanPrWork(state, participants, policy)`: skip a
  non-open pull request (`pr-closed`), apply `unsafeBranchSkip`, fold the agent's own review-thread
  comments into the pull-request analysis, compute the actionable threads, skip when there is
  nothing new (`no-new-messages`), otherwise return a `pr-orphan` work item on the head branch with
  `issue: null`, the empty issue analysis, `needsAssignment: false` and no ambiguous pull requests.
  (FR-003, FR-004, FR-005)
- [X] **T007** Tests in `tests/unit/workDetection.test.ts` for the orphan decision table: a new
  authorized comment is work; an unresolved authorized thread is work; a review body is work; the
  agent having answered is not work; a pull-request body/commit from an unauthorized author is not
  work; a fork is `unsafe-pr-branch`; a protected head is `unsafe-pr-branch`; a merged/closed pull
  request is `pr-closed`. Also assert that existing `decideWork` behaviour is unchanged.
  (FR-003, FR-004, FR-005)

## Phase 4 — The prompt

- [X] **T008** In `src/github/workPrompt.ts`: emit the issue identity, the issue conversation and the
  new-issue-message block only when `item.issue !== null`; keep the pull-request identity,
  conversation and thread blocks as they are. (FR-007)
- [X] **T009 [P]** Tests in `tests/unit/workPrompt.test.ts`: a `pr-orphan` prompt names the pull
  request, contains no `Issue #` line and no issue-conversation heading, and still carries the new
  pull-request messages and the unresolved threads; an `issue-discuss` prompt is unchanged. (FR-007)

## Phase 5 — The command

- [X] **T010** `src/commands/doWork.ts` plumbing: add `--pr <number>` and `onlyPr` to `Settings`;
  add the `pr-orphan` prompt to `Settings.prompts`; accept `prOrphan` in
  `validateSettingContainer(section["prompts"], …)`. (FR-006, FR-008)
- [X] **T011** Orphan discovery in the command: `prMatchesFilter(candidate, settings)` mirroring
  `issueMatchesFilter`; `discoverOrphanPrs(settings, linkMap)` returning the matching candidates,
  handling `--pr` (present in `orphans` → use it, warning when it does not match the filter; present
  in `byIssue` → fail naming the issue and pointing at `--issue`; absent from the map → fail as not
  an open pull request). (FR-002, FR-008, FR-010)
- [X] **T012** The second pass: run it after the issue pass; suppress the issue pass when `--pr` is
  given without `--issue` and the orphan pass when `--issue` is given without `--pr`; build orphan
  decisions from `getPrSurface`; append them to the plan; share one `runsUsed` budget with the issue
  items, issues first. (FR-001, FR-009, FR-011)
- [X] **T013** Per-item handling for `pr-orphan`: refresh against a fresh link map and skip on
  `pr-linked` / `pr-closed` / answered; prepare the head branch with `preparePrBranch`; no
  assignment, no pickup note, no link repair; marker on the pull request; unchanged reconciliation.
  (FR-012, FR-013, FR-014)
- [X] **T014** Reporting: `ItemReport.issue` nullable plus a new `pr` field; an `itemLabel()` helper
  printing `#42` or `PR #61` used by the plan, the progress lines, the dry-run header and the
  summary; `pr` added to `toItemJson`, `toPlanJson` and `toRunJson`. (FR-015, FR-016, FR-017)
- [X] **T015** Tests in `tests/unit/doWork.cmd.test.ts`: a matching orphan pull request with an
  unanswered authorized comment runs one `pr-orphan` turn on its head branch with the marker on the
  pull request; a matching orphan with no authorized message runs nothing; a non-matching orphan is
  not discovered; the shared cap defers the orphan item after the issues; `--pr N` restricts the
  tick and suppresses the issue pass; `--pr N` on a linked pull request exits 1 naming the issue;
  `--pr N` on an unknown number exits 1; no assignment and no `addClosesRefToPr` for an orphan turn;
  `--json` reports `issue: null` and the pull request number; `--dry-run` describes the item.
  Update the existing link-map mocks with `orphans: []` and the `--json` assertion for the new `pr`
  field. (FR-001, FR-008 – FR-017)

## Phase 6 — Configuration surfaces

- [X] **T016** `src/commands/config.ts`: add `"pr-orphan"` to `VALID_TURN_KINDS` and replace the
  if/else in `do-work-prompt` with an exhaustive switch over the three kinds. (FR-006)
- [X] **T017 [P]** Test in `tests/unit/config.cmd.test.ts`:
  `config set do-work-prompt pr-orphan "…"` writes `doWork.prompts.prOrphan` and leaves the other
  two untouched; an unknown turn kind still exits 1 and lists all three. (FR-006)
- [X] **T018** `src/config/ConfigWizard.tsx`: append `"Do Work — Orphan PR"` to
  `PROMPTS_MENU_OPTIONS`, add the `do-work-pr-orphan-prompt` screen (text screen, view and
  `PROMPT_SCREEN_BY_OPTION` entry) writing `.automata/do-work-pr-orphan.md`. (FR-006)
- [X] **T019 [P]** Test in `tests/unit/ConfigWizard.test.tsx`: navigating Prompts → Do Work — Orphan
  PR and submitting writes the prompt file and `doWork.prompts.prOrphan`. (FR-006)

## Phase 7 — Documentation

- [X] **T020** `docs/do-work.md`: `--pr` in the options table, the `pr-orphan` row in Turn kinds, the
  orphan pass in How it works, the orphan trigger rule in Detection rules, the new skip reasons in
  Exit codes, the `pr` field and nullable `issue` in the `--json` description, and the "never
  assigns an orphan pull request" note.
- [X] **T021 [P]** `docs/config.md`: `prompts.prOrphan` in the `doWork` table and in the example.
- [X] **T022 [P]** `docs/wiki/Detection-Rules.md`: the orphan pull-request rule beside the issue and
  pull-request rules.
- [X] **T023** Review `README.md` per the constitution: update only if the command-group table, the
  quick start, installation or dev setup actually changed.

## Phase 8 — Gate

- [X] **T024** `npm test && npm run lint` (read the real lint gate with `npx eslint src/` per project
  memory), plus an explicit `npx tsc --noEmit --strict …` over every new or changed test file, since
  `tsconfig.json` covers only `src`.
