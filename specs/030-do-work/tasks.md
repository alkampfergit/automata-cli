# Tasks: `do-work` Autonomous Orchestrator

**Input**: Design documents from `specs/030-do-work/`
**Prerequisites**: `spec.md`, `research.md`, `plan.md`

Tasks marked **[P]** touch disjoint files and may run in parallel.

## Phase 1: Configuration model

- [X] T001 Add `TurnKind`, `DoWorkPrompts`, `AutomataDoWorkConfig`, the `doWork?` field on `AutomataConfig`, the exported `DEFAULT_DO_WORK` defaults (`baseBranch: "develop"`, `executor: "claude"`, `maxRunsPerTick: 0`, `lockStaleMinutes: 120`) and the two default prompt constants to `src/config/configStore.ts` (FR-041)
- [X] T002 Write `DEFAULT_DO_WORK_ISSUE_DISCUSS_PROMPT` and `DEFAULT_DO_WORK_PR_WORK_PROMPT` so each states its turn boundary explicitly and names no skill: discuss must not touch files unless a NEW message asks for implementation, in which case branch and open a PR whose body closes the issue; PR-work must work on the named branch, commit, push, answer on the PR, never merge and never push to the base branch (FR-035)
- [X] T003 Resolve `doWork.prompts.issueDiscuss` and `doWork.prompts.prWork` through the existing `resolvePromptRef()` in `readConfig()`, keeping the existing `.md` rules, and expose the resolution failure to callers rather than swallowing it (FR-033)
- [X] T004 Extend `tests/unit/configStore.test.ts` for `doWork` defaults, `doWork.prompts.*` file-reference resolution, the escape-outside-`.automata/` rejection and the missing-file error (FR-033, FR-041)
- [X] T005 Add `config set do-work-base-branch`, `do-work-executor` (validated against `claude`/`codex`), `do-work-model`, `do-work-max-runs` (non-negative integer), `do-work-lock-stale-minutes` (positive integer) and `do-work-prompt <turn-kind> <value>` (turn kind validated) to `src/commands/config.ts`, each merging into the `doWork` section (FR-043)
- [X] T006 Extend `tests/unit/config.cmd.test.ts` for every new `config set` subcommand, including rejection of an unknown executor, non-numeric values and an unknown turn kind (FR-043)

## Phase 2: Conversation rules (tests first)

- [X] T007 Write `tests/unit/conversation.test.ts` covering: boundary from the newest agent message; `issue-body` excluded from the boundary; first-run behaviour with no agent message; agent messages never new even when the agent is listed in `allowedUsers`; unauthorized authors excluded from both detection and output; case-insensitive login matching; strict-inequality timestamp ties; `lastAuthorClass` returning each of `agent`/`authorized`/`other`/`none`; `formatMessages` NEW markers (FR-011 – FR-013)
- [X] T008 Implement `src/github/conversation.ts` with `RawMessage`, `AnalyzedMessage`, `SurfaceAnalysis`, `Participants`, `analyzeSurface()`, `lastAuthorClass()` and `formatMessages()` as pure functions with no I/O imports, until T007 passes (FR-011 – FR-013)
- [X] T009 Reimplement `src/github/issueConversation.ts` as a mapping onto `analyzeSurface()`, preserving its exported API (`ConversationMessage`, `ConversationAnalysis`, `analyzeConversation`, `formatConversation`) exactly, and verify `tests/unit/issueConversation.test.ts` and `tests/unit/executePromptCheckIssue.cmd.test.ts` still pass **without being modified** (FR-003)

## Phase 3: GitHub access for `do-work`

- [X] T010 Create `src/github/ghWorkService.ts` with the private `spawnSync` runner pattern plus `getRepoSlug()` and `listCandidateIssues()` (reusing the existing discovery-technique argument mapping) (FR-008)
- [X] T011 Add `IssueSurface` and `getIssueSurface()` to `ghWorkService.ts`: `gh issue view <n> --json number,title,body,url,state,author,createdAt,assignees,comments`, flattening `author.login` and assignee logins, emitting the issue body as an `issue-body` message and comments as `issue-comment`, sorted ascending by `createdAt` (FR-011, FR-020)
- [X] T012 Add `getOpenPrLinkMap()` to `ghWorkService.ts`: one GraphQL query over `pullRequests(states:OPEN, first:100)` selecting `number,url,title,updatedAt,headRefName,isDraft` and `closingIssuesReferences(first:10)`, inverted into `Map<issueNumber, PullRequestRef[]>` (FR-009, R1)
- [X] T013 Add `getPrSurface()` to `ghWorkService.ts`: `gh pr view <n> --json number,title,url,headRefName,state,isDraft,body,author,createdAt,comments,reviews` for the conversation surface, plus a GraphQL review-thread query selecting `isResolved,isOutdated,path,line` and `comments(last:100)`; drop empty review bodies; do **not** modify `getPrComments()` in `src/git/gitService.ts` (FR-016, R2, R3)
- [X] T014 Add `assignIssueToAgent()` to `ghWorkService.ts` (`gh issue edit <n> --add-assignee <agentUser>`, additive so existing assignees survive), surfacing `gh` stderr on failure (FR-020)
- [X] T014a Add `MarkerRef`, `postMarker()`, `updateMarker()` and `deleteMarker()` to `ghWorkService.ts`: post through `gh api repos/{owner}/{repo}/issues/{n}/comments` so the response's `id` and `created_at` are captured, `PATCH .../issues/comments/{id}` to update, `DELETE` on the same path to remove, treating a 404 on delete as success; one implementation serves both surfaces because a pull request is an issue (FR-021, FR-023, FR-024, R13)
- [X] T015 [P] Write `tests/unit/ghWorkService.test.ts` with `spawnSync` mocked, covering: link-map inversion; an issue closed by two open PRs; `author.login` and assignee flattening; chronological sorting; empty review bodies dropped; thread comments ordered oldest-first; `assignIssueToAgent` issuing `--add-assignee`; `postMarker` returning the id and `created_at` from the REST response; `updateMarker` issuing `PATCH`; `deleteMarker` issuing `DELETE` and treating 404 as success; non-zero `gh` status surfaced as an error; `gh` missing (`ENOENT`) reported clearly (FR-008, FR-009, FR-016, FR-020, FR-021, FR-023, FR-024)

## Phase 4: Turn detection (tests first)

- [X] T016 Write `tests/unit/workDetection.test.ts` with one case per row of the plan's decision table, plus: an issue whose only linked PRs are merged or closed treated as having no PR; new messages on both surfaces producing exactly one `pr-work` item that carries both; an unresolved thread whose newest comment is the agent's excluded from `actionableThreads`; an unresolved thread whose newest comment is a bot's excluded; a resolved thread with a new authorized comment excluded; several open linked PRs resolving to the most recently updated with the rest in `ambiguousPrs`; the `branch` field being the base branch for discuss and the head branch for `pr-work`; `needsAssignment` true when the agent is absent from the assignees and false when present, matched case-insensitively (FR-014 – FR-020)
- [X] T017 Implement `src/github/workDetection.ts` with `IssueState`, `SkipReason`, `WorkItem`, `Decision` and `decideWork()` as pure functions, until T016 passes (FR-014 – FR-020)
- [X] T017a Add tests to `tests/unit/workDetection.test.ts` for `agentAnsweredAfter()`: an agent message newer than the marker → true; the marker comment itself → false; an agent message older than the marker → false; a newer message from an authorized human → false; an agent reply inside a review thread → true; an exact timestamp tie → false (FR-022)
- [X] T017b Implement `agentAnsweredAfter(messages, agentUser, marker)` in `src/github/workDetection.ts` as a pure predicate, until T017a passes (FR-022)

## Phase 5: Prompt composition (tests first)

- [X] T018 Write `tests/unit/workPrompt.test.ts` covering: the configured frame appearing first and verbatim; repository, agent identity, turn kind, base branch, issue number/title/URL present for both turn kinds; PR number/URL/branch present for `pr-work` and absent for discuss; new messages rendered under their own heading; the full filtered conversation present; unresolved threads rendered with path and line; content from unauthorized accounts absent; the withheld-messages notice present; the shipped default frames carrying their turn boundary and naming no skill (FR-033 – FR-035)
- [X] T019 Implement `src/github/workPrompt.ts` with `PromptInput` and `composePrompt()` as pure functions, frame first and context appended, until T018 passes (FR-033, FR-034)

## Phase 6: Workspace preparation

- [X] T020 [P] Create `src/git/workspaceService.ts` with `PrepareResult`, `prepareBaseBranch()` (reusing `hasUncommittedChanges()` and `checkoutAndPull()`) and `preparePrBranch()` (fetch, checkout creating a local tracking branch when needed, `pull --ff-only`), refusing before any git mutation when the tree is dirty and never stashing or resetting (FR-027 – FR-029)
- [X] T021 [P] Write `tests/unit/workspaceService.test.ts` covering: dirty tree refused with `dirty-tree` and no git mutation attempted; base branch prepared; head branch created from the remote when absent locally; checkout failure reported as `checkout-failed`; a diverged branch reported as `pull-failed` rather than merged (FR-027 – FR-029)

## Phase 7: Run lock

- [X] T022 [P] Create `src/run/runLock.ts` with `LockHandle`, `AcquireResult` and `acquireRunLock(command, staleMinutes)` writing `.automata/automata.lock` with `flag: "wx"` and `{ pid, startedAt, host, command }`; on `EEXIST` treat a live pid inside the staleness window as held and otherwise reclaim; treat an unparseable lock as stale; `release()` idempotent (FR-031)
- [X] T023 [P] Write `tests/unit/runLock.test.ts` covering: acquisition on a clean directory; contention against a live pid; reclaim of a lock whose pid is dead; reclaim of a lock older than the staleness window; an unparseable lock file reclaimed; idempotent release (FR-031)
- [X] T024 [P] Add `.automata/automata.lock` to `.gitignore` (FR-031)

## Phase 8: The `do-work` command

- [X] T025 Create `src/commands/doWork.ts` with the commander surface: `--with`, `--model`, `--issue <number>`, `--limit <n>`, `--max-runs <n>`, `--dry-run`, `--json`, `--silent`; register it in `src/index.ts` (FR-001, FR-002)
- [X] T026 Implement precondition validation and settings resolution: reject `remoteType !== "gh"` with the `docs/azdo-gap.md` pointer; reject missing discovery technique/value, `allowedUsers` and `agentUser`, each naming the command that sets it; reject an unresolvable configured prompt rather than falling back to the default; resolve CLI option over `doWork` config over default (FR-005 – FR-007, FR-042); exit 1 on any failure
- [X] T027 Wire the run lock around the whole tick, acquired before any state-changing GitHub call, exiting 0 with a message naming the holding pid and command when it is held by a live instance, and releasing it in `finally` and on `SIGINT`/`SIGTERM` (FR-031, FR-032)
- [X] T028 Implement discovery: `listCandidateIssues()` honouring `--limit` and reporting truncation, or the single `--issue` path (reporting when it does not match the configured filter), then one `getOpenPrLinkMap()` call (FR-008 – FR-010)
- [X] T029 Build one `IssueState` per candidate — `getIssueSurface()`, and `getPrSurface()` only when an `OPEN` linked PR exists (newest by `updatedAt`) — then call `decideWork()` per issue (FR-011, FR-015, FR-017)
- [X] T030 Implement the work plan output: one line per issue with turn kind or skip reason, the reason text and whether the issue would be assigned; `--json` emitting the plan on stdout with progress on stderr; `--dry-run` exiting 0 after the plan with nothing assigned, nothing posted, no branch change, no executor and no link repair (FR-037 – FR-039)
- [X] T031 Implement the per-item execution loop in the order branch-prepare → assign → marker → model → reconcile: apply the run cap marking the remainder deferred; skip the item on branch-preparation failure; assign the issue to the agent when `needsAssignment`, warning and proceeding on failure; post the marker comment on the answering surface and skip the item without invoking the executor when it fails; compose the prompt; invoke Claude or Codex with `yolo: true`, streaming unless `--silent`; record the outcome and continue past a thrown error (FR-020 – FR-025, FR-030)
- [X] T032 Implement marker reconciliation, running for every item whose model was invoked — including one whose run threw — before link repair and before the loop advances: re-read the answering surface (for a build turn, the union of PR conversation messages, review bodies and every review-thread comment), call `agentAnsweredAfter()`, then delete the marker when it returns true and update it in place with what happened when it returns false; never delete on a false result and never delete on the strength of the exit code alone; a delete or update failure warns and leaves the item's outcome unchanged (FR-022 – FR-024, FR-026)
- [X] T032a Implement link repair after an `issue-discuss` turn: `getCurrentBranchPr()`, and when a PR exists whose body has no closing reference to the issue, call `addClosesRefToPr()`; leave the body untouched when the reference is present; run it for no other turn kind (FR-036)
- [X] T033 Implement the end-of-tick summary (one line per item with `answered` / `answered-no-reply` / `skipped` / `failed` / `deferred`) and the exit code: 0 when the tick completed with no failed or skipped item, 2 otherwise (FR-004, FR-040)
- [X] T034 Write `tests/unit/doWork.cmd.test.ts` with the services and executors mocked, covering: each precondition failure exiting 1 including an unresolvable prompt; nothing-to-do exiting 0 with nothing assigned, nothing posted and no executor spawned; three items running sequentially in plan order; a failing item not aborting the tick and forcing exit 2; a skipped item forcing exit 2; `--dry-run` assigning nothing, posting, editing and deleting nothing, and spawning nothing; `--json` shape; `--max-runs` deferring the remainder; `--issue` restricting the tick; lock contention exiting 0 with no GitHub call at all; assignment skipped when the agent is already assigned; assignment failure warning and the turn proceeding; the marker posted after assignment and before the executor; a marker failure skipping the item; the marker deleted when the agent answered; the marker never deleted when it did not; the marker updated in place with an explanation when no answer was produced; a non-zero run that did post an answer still having its marker deleted and being reported as answered; reconciliation running after a thrown run; a delete failure warned about while the item still counts as answered; an update failure warned about while the outcome is unchanged; link repair running only after a discuss turn; `--with`, `--model` and `--silent` forwarded to the executor (FR-002, FR-004, FR-020 – FR-025, FR-030 – FR-032, FR-036, FR-039, FR-040)

## Phase 9: Interactive configuration

- [X] T035 Add a `Do Work` entry appended last to `MAIN_MENU_OPTIONS` in `src/config/ConfigWizard.tsx` with base-branch, executor and run-cap screens that save the `doWork` section, keeping existing menu indices unchanged (FR-043)
- [X] T036 Add `Do Work — Discuss` and `Do Work — PR` entries appended last to `PROMPTS_MENU_OPTIONS`, each pre-filled with the built-in default, writing `.automata/do-work-issue-discuss.md` / `.automata/do-work-pr-work.md` and storing the filename, matching the existing prompt screens (FR-033)
- [X] T037 Extend `tests/unit/ConfigWizard.test.tsx` for the new screens and add the new config-store exports to its mock (FR-033, FR-043)

## Phase 10: Command reference documentation

- [X] T038 Write `docs/do-work.md` in the shape of the existing reference pages: synopsis; options table; required configuration; how it works; detection rules; the `doWork` configuration reference with defaults; lock behaviour; exit codes 0/1/2; a cron example; and links into the wiki for the process (FR-044)
- [X] T039 Document the `doWork` configuration section in `docs/config.md`, including the `config set` subcommands, the prompt file-reference rules and the wizard filename mapping (FR-041, FR-043)
- [X] T040 Add a short `automata do-work` section to `README.md` linking to `docs/do-work.md` and `docs/wiki/Home.md`, keeping the README small per the documentation convention (FR-048)

## Phase 11: The process wiki

- [X] T041 Write `docs/wiki/Home.md`: what the harness is, the one-paragraph model (authorized humans talk, the agent answers, cron ticks), when *not* to use it, and the page map with a one-line description of each page (FR-045)
- [X] T042 Write `docs/wiki/Concepts.md`: the actors (authorized accounts, the agent identity, ignored accounts), the two surfaces, what counts as a message, the agent boundary, the two turn kinds, and why assignment and the marker comment both exist and differ (FR-045)
- [X] T043 Write `docs/wiki/Issue-Lifecycle.md`: one issue walked tick by tick from description through discuss turns, go-ahead, branch and PR, review rounds, to the human merge — with the GitHub-visible state at each step (label, assignee, marker comments, `Closes #N`) and an ASCII state diagram (FR-045)
- [X] T044 Write `docs/wiki/Detection-Rules.md`: the authorization filter, the boundary rule including the strict-inequality tie, the unresolved-thread rule, the PR-existence rule, the merged-PR rule, and the full turn decision table (FR-045)
- [X] T045 Write `docs/wiki/Setup.md`: the isolated VM or codespace, `gh` authentication, choosing and provisioning the agent account with write access so assignment works, the discovery label, `allowedUsers`/`agentUser`, the `doWork` section, a first `--dry-run`, and the cron entry with a note on interval versus tick length (FR-045)
- [X] T046 Write `docs/wiki/Prompts.md`: the contract — automata supplies the context block and guarantees its shape, the configured prompt owns the instructions and is where a skill is named — with the shipped defaults, a worked example prompt that names a skill, and the rule that an unresolvable prompt file fails the tick (FR-047)
- [X] T047 Write `docs/wiki/Operations.md`: running under cron, the run lock and what a contended tick looks like, exit codes 0/1/2 and how to read them from cron mail, the run cap, and the "what the harness never does" list — no merge, no issue closure, no push to the base branch, no action on unauthorized messages, and permission prompts bypassed so it must run in a disposable environment (FR-046)
- [X] T048 Write `docs/wiki/Troubleshooting.md` as a symptom → cause → fix table covering at least: nothing happens; the same message is answered twice; the agent answers its own messages; an issue stays in discussion after a go-ahead (missing closing reference); items are skipped (dirty tree, branch preparation); assignment fails; the tick never starts (stale lock); a prompt file cannot be resolved (FR-045)
- [X] T049 Write `docs/wiki/Roadmap.md`: what is deliberately deferred and why — the Azure DevOps backend, a landing step (merge and issue closure), bot-reviewer turns, and skills as a separate concern (FR-045)
- [X] T050 Cross-check the wiki against the implementation: every rule stated in `Detection-Rules.md` matches `workDetection.ts`, every exit code in `Operations.md` matches the command, and every configuration key in `Setup.md` matches `configStore.ts`; note in `Home.md` how to publish `docs/wiki/` to the repository's GitHub wiki (FR-045)

## Phase 12: Validation and dogfooding

- [X] T051 Run `npm test && npm run lint && npm run typecheck` and fix any failures (SC-010)
- [X] T052 Configure this repository's own `.automata/config.json` `doWork` section and write `.automata/do-work-issue-discuss.md` and `.automata/do-work-pr-work.md`, naming the skills this repository wants used — exercising the contract from `docs/wiki/Prompts.md` (SC-009)
- [X] T053 Verify `automata do-work --dry-run` reports a correct work plan against the live repository, including which issues would be assigned (SC-008)
- [ ] T054 **Blocked on the agent account** — dogfood one real tick: run a discuss turn on a labelled issue in this repository, then a `pr-work` turn against review feedback on this feature's own pull request, and record the outcome in `specs/030-do-work/pr-report.md` (SC-005, SC-012)
- [ ] T055 **Needs a human reviewer** — hand `docs/wiki/` to a reader unfamiliar with the repository and confirm they can predict the turn for three example issue states without reading the source; fix whatever they had to guess (SC-011)
- [ ] T056 **Needs confirmation (creates public issues)** — open the follow-up issues that this feature deliberately defers, matching `docs/wiki/Roadmap.md`: an Azure DevOps backend for the detection core, a landing step (merge and issue closure), and bot-reviewer turns (spec Assumptions)

## Status

Phases 1–11 complete; validated with `npm test` (521 tests), `npm run lint` and `npm run typecheck`.

Live validation against this repository (T053): `automata do-work --dry-run` and
`--dry-run --json` both run clean through the real `gh` layer (issue discovery,
the GraphQL pull-request link map, repo-slug resolution), and lock contention was
confirmed by holding `.automata/automata.lock` and observing a second instance
exit 0 without touching GitHub.

Notes on what is left:

- **T054** needs the agent GitHub account to exist. `.automata/config.json` has
  everything except `agentUser`, which is deliberately unset — the agent identity
  is the repository owner's decision, and inventing one would put a wrong login
  in the file that defines the answer boundary. Set it with
  `automata config set agent-user <login>` (the account `gh` authenticates as in
  the harness container), then a labelled issue is enough to run a real tick.
- **T055** is a human review pass by design.
- **T056** creates public issues, so it waits for explicit confirmation.

`npm run format` is not clean, but it was already failing on 12 files on
`develop` before this feature and CI does not gate on it, so the new modules
match the surrounding hand-formatted style rather than introducing a repo-wide
reformat in this pull request.
