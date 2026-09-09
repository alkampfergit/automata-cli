# Implementation Plan: `do-work` Autonomous Orchestrator

**Branch**: `feature/030-do-work` | **Date**: 2026-09-09 | **Spec**: `specs/030-do-work/spec.md`

**Input**: Feature specification from `specs/030-do-work/spec.md`

## Summary

Add `automata do-work`: a single, self-contained command that performs one tick of an autonomous SDD loop over the current repository. A tick takes an exclusive repository lock, discovers the open issues carrying the configured label, resolves each issue's linked open pull request in one GraphQL call, and decides per issue whether an authorized human has spoken since the agent last spoke — on the issue, on the pull request conversation, or in an unresolved review thread. Each issue that needs an answer becomes one work item with one of two turn kinds: `issue-discuss` (no linked PR — talk about spec and plan, escalating to branch-and-PR only when a new authorized message asks for it) or `pr-work` (a linked open PR — check out its branch and address the feedback). Before the first model run on an issue the issue is assigned to the agent identity, so the claim is visible in the GitHub UI. Items run sequentially, one model run each, behind a transient "working" marker comment that holds the boundary during the run and is then reconciled: deleted once the model's own answer is confirmed on the surface, or updated in place to say what happened when the model produced nothing. The turn instructions are prompt text held in configuration — that prompt is where a skill gets named, and automata itself has no concept of a skill. Alongside the code, a process wiki under `docs/wiki/` explains the harness end to end.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode), Node.js LTS 18+

**Primary Dependencies**: commander.js; `gh` CLI (REST + GraphQL) and `git` via `node:child_process` `spawnSync`; ink + react (existing wizard); vitest

**Storage**: `.automata/config.json` extended with a `doWork` section; `.automata/*.md` for the per-turn prompts; `.automata/automata.lock` as transient run state. No durable state — every boundary is derived from GitHub.

**Testing**: vitest unit tests; the whole detection core is pure and testable with no `gh` binary

**Target Platform**: Node.js CLI in a disposable VM or codespaces container, run from cron

**Performance Goals**: model calls are the cost centre, not API calls. One tick costs: 1 `gh issue list`, 1 GraphQL query for open PRs, then per candidate issue 1 `gh issue view`, plus for issues with a PR 1 `gh pr view` and 1 GraphQL review-thread query. Zero model calls when nothing needs an answer.

**Constraints**: no new runtime dependencies; no behaviour change to `implement-next` or any `execute-prompt` subcommand; the detection core must not import commander, `gh` or `git`; must be safe to run unattended on a fixed schedule; must work with no skills or plugins installed

**Scale/Scope**: one new top-level command, three new pure modules, three new service modules, one refactor-with-no-behaviour-change of the existing conversation analysis, one config section, wizard and `config set` coverage, a command reference page, a nine-page process wiki, and unit tests

## Constitution Check

- ✅ **I. CLI-First**: a commander.js top-level command with explicit options; work plan and summary on stdout, warnings and progress on stderr; `--json` for machine consumption; documented exit codes 0/1/2.
- ⚠️ **III. Single Responsibility**: `do-work` is by nature an orchestrator, which reads as "combining unrelated operations". It is admissible because the operations are not unrelated — they are one decision procedure (what should the agent answer next?) that cannot be split without pushing the state machine into the caller, which is exactly what this feature exists to remove. The principle is honoured internally: discovery, detection, prompt composition, branch preparation and execution are separate modules and the command file only sequences them. Recorded in Complexity Tracking.
- ✅ **II. TypeScript Strictness**: no `any`; every `gh` payload is parsed into an explicit `Raw*` shape and normalised into exported interfaces before it reaches the detection core.
- ✅ **IV. npm Distribution**: no new dependencies, no build changes.
- ⚠️ **V. Simplicity / configuration**: the `doWork` section adds configuration rather than flags. Justified as in feature 029 — the base branch, the trust list and the per-turn prompts are stable per-repository facts that a cron line must not have to restate, and prompt text cannot live on a command line at all. Every field has a working default, so the harness runs with an empty `doWork` section. Recorded in Complexity Tracking.
- ✅ **Development Workflow**: `npm test && npm run lint` gate; `docs/do-work.md` created, `docs/wiki/` authored and `README.md` updated per the documentation convention; feature work on `feature/030-do-work` merged via PR.

## Project Structure

### Documentation (this feature)

```text
specs/030-do-work/
├── spec.md
├── research.md
├── plan.md
├── tasks.md
├── spec-decisions.md
└── checklists/
    └── requirements.md
```

### Source Code Changes

```text
src/
├── commands/
│   ├── doWork.ts               # NEW: command surface + tick sequencing only
│   └── config.ts               # `config set do-work-*` subcommands
├── config/
│   ├── configStore.ts          # AutomataDoWorkConfig + default prompts + prompt refs
│   └── ConfigWizard.tsx        # "Do Work" wizard screens
├── github/
│   ├── conversation.ts         # NEW: remote-agnostic message/boundary rules (pure)
│   ├── issueConversation.ts    # REFACTOR: thin wrapper over conversation.ts, same API
│   ├── workDetection.ts        # NEW: IssueState -> WorkItem decision (pure)
│   ├── workPrompt.ts           # NEW: WorkItem -> prompt text (pure)
│   └── ghWorkService.ts        # NEW: gh calls do-work needs (issue+PR surfaces, PR link
│                               #      map, unresolved threads, assignment, markers)
├── git/
│   └── workspaceService.ts     # NEW: clean-tree check, base/PR branch preparation
└── run/
    └── runLock.ts              # NEW: exclusive per-repository automata run lock

docs/
├── do-work.md                  # NEW: terse command reference (per the docs convention)
├── config.md                   # the `doWork` section, wizard and `config set` mapping
└── wiki/                       # NEW: the process wiki (see below)

tests/
└── unit/
    ├── conversation.test.ts        # NEW: boundary + authorization rules
    ├── workDetection.test.ts       # NEW: turn-kind decision table
    ├── workPrompt.test.ts          # NEW: prompt contract
    ├── runLock.test.ts             # NEW: acquire / contend / reclaim / release
    ├── ghWorkService.test.ts       # NEW: gh payload normalisation, assignment
    ├── workspaceService.test.ts    # NEW: branch preparation and refusal to clobber
    ├── doWork.cmd.test.ts          # NEW: tick sequencing, dry-run, caps, exit codes
    ├── issueConversation.test.ts   # unchanged — proves the refactor is behaviour-free
    ├── configStore.test.ts         # doWork defaults and prompt resolution
    ├── config.cmd.test.ts          # new `config set` subcommands
    └── ConfigWizard.test.tsx       # new wizard screens

.automata/
├── config.json                 # dogfooding: a real `doWork` section for this repo
├── do-work-issue-discuss.md    # dogfooding: the discuss prompt, naming a skill
└── do-work-pr-work.md          # dogfooding: the build prompt, naming a skill
.gitignore                      # ignore `.automata/automata.lock`
README.md                       # short `automata do-work` section + wiki link
```

### The wiki (`docs/wiki/`)

Authored in-repo so it is reviewed in the same pull request as the behaviour it describes, with filenames chosen so the directory can be pushed verbatim to the repository's GitHub wiki (which is enabled but empty).

```text
docs/wiki/
├── Home.md                     # what the harness is, when to use it, page map
├── Concepts.md                 # actors, surfaces, messages, the agent boundary, turns
├── Issue-Lifecycle.md          # one issue from description to merged PR, tick by tick
├── Detection-Rules.md          # authorization filter, boundary, thread rule, decision table
├── Setup.md                    # VM/codespace, gh auth, agent account, config, cron entry
├── Prompts.md                  # the prompt contract + a worked example naming a skill
├── Operations.md               # running under cron, the lock, exit codes, safety boundaries
├── Troubleshooting.md          # symptom -> cause -> fix
└── Roadmap.md                  # what is deliberately deferred and why
```

**Division of labour with the existing docs**: `docs/<group>.md` pages stay what they are today — terse references listing options, output shape and exit codes. The wiki carries the process: why a turn happens, how the phases relate, how to operate the loop. `docs/do-work.md` is the command reference and links into the wiki for the process; the wiki links back for exact option semantics. Neither restates the other, so there is one place to change for each kind of fact.

**Structure Decision**: Keep the flat single-project layout. Three facts drive the placement:

1. The **detection core is pure and remote-agnostic** — `conversation.ts`, `workDetection.ts` and `workPrompt.ts` import nothing but types. This is what makes the decision table testable without a `gh` binary and what will let an Azure DevOps backend be added later by writing a second service, not a second state machine.
2. **`gh` access for `do-work` gets its own service** (`ghWorkService.ts`) rather than growing `config/githubService.ts` or `git/gitService.ts` (981 lines already). It reuses the same private `spawnSync` runner pattern.
3. **`do-work` shares no command module** with `implement-next` or `execute-prompt`, per FR-003. It shares only leaf services: `claudeService`, `codexService`, `configStore`, and the existing `addClosesRefToPr` / `getCurrentBranchPr` helpers used for link repair.

The single edit to existing behaviour-bearing code is the `issueConversation.ts` refactor, whose existing test file is deliberately left untouched as the proof that nothing changed.

## Implementation Design

### 1. Configuration (`src/config/configStore.ts`)

There is no skill mapping. The turn instructions *are* the configured prompts, and naming a skill is the prompt's job.

```ts
export type TurnKind = "issue-discuss" | "pr-work";

export interface DoWorkPrompts {
  issueDiscuss?: string;   // prompt text, or "<name>.md" inside .automata/
  prWork?: string;
}

export interface AutomataDoWorkConfig {
  baseBranch?: string;            // default "develop"
  executor?: "claude" | "codex";  // default "claude"
  model?: string;
  maxRunsPerTick?: number;        // default 0 = unlimited
  lockStaleMinutes?: number;      // default 120
  prompts?: DoWorkPrompts;
}

export interface AutomataConfig {
  // …existing fields (remoteType, issueDiscovery*, allowedUsers, agentUser, prompts)
  doWork?: AutomataDoWorkConfig;
}

export const DEFAULT_DO_WORK_ISSUE_DISCUSS_PROMPT: string;
export const DEFAULT_DO_WORK_PR_WORK_PROMPT: string;
export const DEFAULT_DO_WORK: Required<Pick<AutomataDoWorkConfig,
  "baseBranch" | "executor" | "maxRunsPerTick" | "lockStaleMinutes">>;
```

`readConfig()` resolves `doWork.prompts.*` through the existing `resolvePromptRef()`, so the `.md`-filename rules (plain filename, no subdirectories, must stay inside `.automata/`) apply unchanged. Unlike the existing prompts, an unresolvable reference is fatal for `do-work` (FR-007): silently falling back to the default would change agent behaviour invisibly on an unattended loop.

The built-in defaults state the turn boundary and name no skill (FR-035), so the harness works with nothing installed:

```text
DEFAULT_DO_WORK_ISSUE_DISCUSS_PROMPT (abridged)
  You are the agent named below, working on a GitHub issue with the people
  allowed to instruct you. Answer the messages marked NEW.
  Do not modify, create or delete any file, and do not create a branch or a
  pull request, UNLESS a message marked NEW explicitly asks you to implement.
  If it does: create a branch off the base branch, implement, and open a pull
  request whose body contains `Closes #<issue>`.
  Otherwise reply on the issue only — specification, plan, open questions.

DEFAULT_DO_WORK_PR_WORK_PROMPT (abridged)
  …work on the branch named below, which is already checked out and up to date.
  Address every message marked NEW and every unresolved review thread listed.
  Commit and push to that branch. Do not merge the pull request and do not push
  to the base branch. Reply on the pull request with a short summary.
```

Precedence (FR-042): CLI option → `doWork` section → built-in default.

### 2. Remote-agnostic conversation rules (`src/github/conversation.ts`, pure)

```ts
export interface RawMessage {
  kind: "issue-body" | "issue-comment" | "pr-comment" | "pr-review" | "thread-comment";
  author: string;
  body: string;
  createdAt: string;
}

export interface AnalyzedMessage extends RawMessage { isNew: boolean }

export interface SurfaceAnalysis {
  messages: AnalyzedMessage[];   // authorized + agent only, oldest first
  newMessages: AnalyzedMessage[];
  hasNewMessage: boolean;
  lastAgentAt: string | null;
}

export interface Participants { allowedUsers: string[]; agentUser: string }

export function analyzeSurface(messages: RawMessage[], p: Participants): SurfaceAnalysis;
export function lastAuthorClass(messages: RawMessage[], p: Participants):
  "agent" | "authorized" | "other" | "none";
export function formatMessages(messages: AnalyzedMessage[]): string;
```

Rules, lifted verbatim from feature 029 so behaviour is identical:

1. Logins compared lower-cased.
2. `lastAgentAt` = greatest `createdAt` among messages authored by the agent, **excluding** `issue-body` (an issue opened by the agent must not act as a boundary).
3. `isNew` when the author is authorized **and** is not the agent **and** (`lastAgentAt === null` or `createdAt > lastAgentAt`) — strict inequality, so a tie is not new.
4. `messages` keeps authorized and agent messages; everything else is dropped entirely.

`issueConversation.ts` keeps its current exported API (`analyzeConversation`, `formatConversation`, `ConversationMessage`, `ConversationAnalysis`) and is reimplemented as a mapping onto `analyzeSurface`, so `executePrompt check-issue` and `tests/unit/issueConversation.test.ts` are unaffected.

### 3. GitHub access (`src/github/ghWorkService.ts`)

```ts
export interface PullRequestRef {
  number: number; url: string; title: string;
  headRefName: string; state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean; updatedAt: string;
}

export interface ReviewThread {
  path: string; line: number | null; isResolved: boolean;
  comments: RawMessage[];            // oldest first, kind "thread-comment"
}

export interface IssueSurface {
  issue: GitHubIssue;
  state: "OPEN" | "CLOSED";
  assignees: string[];
  messages: RawMessage[];
}

export interface PrSurface {
  pr: PullRequestRef;
  messages: RawMessage[];            // conversation comments + non-empty review bodies
  threads: ReviewThread[];
}

export function getRepoSlug(): { owner: string; repo: string };
export function listCandidateIssues(t: IssueDiscoveryTechnique, v: string, limit: number): GitHubIssue[];
export function getIssueSurface(issueNumber: number): IssueSurface;
export function getOpenPrLinkMap(): Map<number, PullRequestRef[]>;   // issue → PRs, one call
export function getPrSurface(prNumber: number): PrSurface;
export function assignIssueToAgent(issueNumber: number, agentUser: string): void;

export interface MarkerRef { commentId: string; createdAt: string }
export function postMarker(surface: "issue" | "pr", number: number, body: string): MarkerRef;
export function updateMarker(marker: MarkerRef, body: string): void;
export function deleteMarker(marker: MarkerRef): void;   // tolerates "already gone"
```

- `getIssueSurface()` requests `--json number,title,body,url,state,author,createdAt,assignees,comments`, so the assignee check needs no extra call.
- `assignIssueToAgent()` runs `gh issue edit <n> --add-assignee <agentUser>`. `--add-assignee` is additive, so a human assignee is preserved (spec edge case). The caller decides whether to call it; the function itself is a thin wrapper that throws the `gh` stderr.
- `getOpenPrLinkMap()` runs the R1 query (`pullRequests(states:OPEN, first:100)` selecting `closingIssuesReferences`) and inverts it. More than one PR per issue is kept in the list so the command can pick the most recently updated one and report the ambiguity.
- `getPrSurface()` runs `gh pr view <n> --json number,title,url,headRefName,state,isDraft,body,author,createdAt,comments,reviews` plus the R2 review-thread query with `comments(last:100)`. Review bodies with empty text are dropped.
- Every function flattens `author.login` to a plain string, sorts by `createdAt` ascending, and throws the `gh` stderr on non-zero status.
- `postMarker()` needs the comment's id and creation time, which `gh issue comment` / `gh pr comment` do not return in a usable form (the existing `postComment()` scrapes a URL out of stderr). It therefore posts through `gh api repos/{owner}/{repo}/issues/{n}/comments`, whose JSON response carries `id` and `created_at`. A pull request is an issue in GitHub's model, so the same endpoint serves both surfaces — which is also why `updateMarker()` and `deleteMarker()` are single implementations rather than one per surface.
- `updateMarker()` is `PATCH .../issues/comments/{id}`; `deleteMarker()` is `DELETE` on the same path and treats a 404 as success, because the model may have removed the comment itself (spec edge case).
- `getPrComments()` in `src/git/gitService.ts` is **not** touched (R2).

### 4. Turn decision (`src/github/workDetection.ts`, pure)

```ts
export interface IssueState {
  issueSurface: IssueSurface;
  linkedPrs: PullRequestRef[];      // as returned by the link map, unfiltered
  prSurface: PrSurface | null;      // fetched only when an open linked PR exists
}

export type SkipReason = "issue-closed" | "no-new-messages";

export interface WorkItem {
  issue: GitHubIssue;
  turn: TurnKind;
  pr: PullRequestRef | null;
  branch: string;                  // base branch for discuss, head branch for pr-work
  needsAssignment: boolean;        // agentUser not already among the assignees
  issueAnalysis: SurfaceAnalysis;
  prAnalysis: SurfaceAnalysis | null;
  actionableThreads: ReviewThread[];
  reason: string;                  // human-readable, printed in the work plan
  ambiguousPrs: PullRequestRef[];  // non-empty when several open PRs close the issue
}

export type Decision =
  | { kind: "work"; item: WorkItem }
  | { kind: "skip"; issue: GitHubIssue; reason: SkipReason; detail: string };

export function decideWork(state: IssueState, p: Participants, baseBranch: string): Decision;
```

Decision table:

| Issue state | Linked open PR | New issue msgs | New PR msgs / actionable threads | Result |
|---|---|---|---|---|
| closed | – | – | – | skip `issue-closed` |
| open | none | ≥1 | – | work `issue-discuss` on `baseBranch` |
| open | none | 0 | – | skip `no-new-messages` |
| open | open PR | any | ≥1 | work `pr-work` on `pr.headRefName` |
| open | open PR | ≥1 | 0 | work `pr-work` on `pr.headRefName` (new issue messages carried into the prompt) |
| open | open PR | 0 | 0 | skip `no-new-messages` |
| open | only merged/closed PRs | ≥1 | – | work `issue-discuss` (FR-017) |

`actionableThreads` = threads where `!isResolved` and `lastAuthorClass(thread.comments) === "authorized"` (R2). When several open PRs close the issue, the most recently `updatedAt` one is chosen and the rest are reported in `ambiguousPrs`. `needsAssignment` is computed here (pure) from the surface's assignees, so the command needs no extra query and `--dry-run` can report it.

### 5. Marker reconciliation (`src/github/workDetection.ts`, pure + command glue)

The decision of whether the model answered is a pure predicate over freshly fetched messages, so it lives with the other pure rules and is unit-testable:

```ts
export function agentAnsweredAfter(
  messages: RawMessage[],          // the answering surface, re-read after the run
  agentUser: string,
  marker: { commentId: string; createdAt: string },
): boolean;
```

True when a message exists whose author is the agent, whose `createdAt` is strictly newer than the marker's, and which is not the marker itself. For a build turn the message list passed in is the union of the PR conversation messages, the review bodies and every review-thread comment, so a reply inside a thread counts as an answer (FR-022).

Reconciliation then runs in the command (FR-022 – FR-024, FR-026):

```text
after the executor returns or throws:
  reread  = getIssueSurface(issue) | getPrSurface(pr)   # the answering surface
  answered = agentAnsweredAfter(reread messages, agentUser, marker)
  if answered:  deleteMarker(marker)      # only ever here, and only after confirming
  else:         updateMarker(marker, "<what happened, no answer produced>")
  a failure of either call warns and does not change the item's outcome
```

Two invariants make this safe:

- **Confirm before deleting.** Deleting the marker without an answer would move the boundary backwards and the same human message would be answered again on the next tick. The delete is therefore guarded by the predicate, never by the executor's exit code — a run that exits non-zero but did post an answer has its marker deleted and is reported as answered with the exit code noted.
- **Update never deletes.** `PATCH` leaves `created_at` untouched, so a run that produced nothing still holds the boundary and is not retried automatically. The updated text is the only channel that tells an authorized human a reply is needed, which is why an update failure is warned about loudly and names the issue.

Outcomes reported per item become `answered`, `answered-no-reply`, `skipped`, `failed` and `deferred`.

### 6. Prompt composition (`src/github/workPrompt.ts`, pure)

```ts
export interface PromptInput {
  item: WorkItem;
  repo: { owner: string; repo: string };
  agentUser: string;
  baseBranch: string;
  frame: string;          // the resolved configured prompt for this turn kind
}
export function composePrompt(input: PromptInput): string;
```

The configured prompt comes first, verbatim, and automata appends only the context it alone can assemble (FR-033, FR-034):

```text
<frame — the configured prompt, verbatim>

--- Context assembled by automata ---
Repository: <owner>/<repo>
You are: <agentUser>
Turn: issue-discuss | pr-work
Base branch: <baseBranch>
Issue #<n>: <title>
Issue URL: <url>
[Pull request #<n>: <title>]
[Pull request URL: <url>]
[Branch: <headRefName>   (checked out and up to date)]

New since your last message — this is what you must answer:
<formatted new messages>

Full conversation (authorized accounts and you only, oldest first):
<formatted messages, NEW markers retained>

[Unresolved review threads needing an answer:
[<author>] <path>:<line>
<body>]

Only the messages above exist. Anything from other accounts has been withheld
deliberately — do not ask about it.
```

Keeping the frame first and the context last means a repository can rewrite the instructions completely — including naming a skill — without losing or reordering any data, and the shipped defaults remain a working example.

### 7. Workspace preparation (`src/git/workspaceService.ts`)

```ts
export type PrepareResult =
  | { ok: true; branch: string }
  | { ok: false; reason: "dirty-tree" | "checkout-failed" | "pull-failed"; detail: string };

export function prepareBaseBranch(baseBranch: string): PrepareResult;
export function preparePrBranch(headRefName: string): PrepareResult;
```

Both refuse immediately when `hasUncommittedChanges()` (already exported by `gitService`) is true — never stash, never reset (FR-029). `prepareBaseBranch` reuses `checkoutAndPull()`. `preparePrBranch` fetches, checks out the head branch (creating the local tracking branch if needed) and pulls with `--ff-only`, so a diverged local branch fails loudly instead of merging silently.

### 8. Run lock (`src/run/runLock.ts`)

Repository-scoped and named for automata as a whole, so other long-running commands can adopt it later without a second lock format (spec assumption); in this feature only `do-work` acquires it.

```ts
export interface LockHandle { release(): void }
export type AcquireResult =
  | { ok: true; handle: LockHandle }
  | { ok: false; heldBy: { pid: number; startedAt: string; host: string; command: string } };

export function acquireRunLock(command: string, staleMinutes: number): AcquireResult;
```

`.automata/automata.lock` written with `writeFileSync(path, json, { flag: "wx" })` — an atomic exclusive create on every target platform. On `EEXIST`: parse it; if the pid is alive (`process.kill(pid, 0)`) and `startedAt` is inside the staleness window, return `{ ok: false }`; otherwise unlink and retry once. An unparseable lock file is treated as stale. `release()` unlinks and is idempotent; the command registers it in a `finally` and on `SIGINT`/`SIGTERM` (FR-031). The lock is taken before any state-changing GitHub call, so a contending instance neither assigns, posts nor invokes a model (FR-032).

### 9. Command sequencing (`src/commands/doWork.ts`)

```text
1. Read config; validate preconditions (FR-005 – FR-007), including resolving both
   prompts. Any failure → stderr, exit 1.
2. Resolve effective settings: CLI options over doWork config over defaults.
3. Acquire the run lock. Held by a live instance → message, exit 0. (Before any
   state-changing call, FR-032.)
4. Discovery:
     a. listCandidateIssues(...) honouring --limit (or the single --issue).
     b. getOpenPrLinkMap() — one GraphQL call.
5. Per candidate issue, build IssueState:
     getIssueSurface(); if an OPEN linked PR exists, getPrSurface() for the newest one.
6. decideWork(...) per issue → Decision[].
7. Print the work plan (FR-037), including which issues would be assigned.
   --json emits it on stdout, progress to stderr.
8. --dry-run → exit 0 here (FR-039).
9. Apply the run cap: items beyond it are marked deferred (FR-030).
10. For each work item, in order:
     a. prepare the branch (base for discuss, head for pr-work) → skip on failure.
     b. if item.needsAssignment: assignIssueToAgent() — on failure, warn and continue
        (FR-020).
     c. post the marker comment on the answering surface → skip on failure (FR-021).
     d. compose the prompt and invoke the executor to completion (yolo, streaming
        unless --silent).
     e. issue-discuss only: getCurrentBranchPr(); if a PR exists without a closing
        reference to the issue, addClosesRefToPr() (FR-036).
     f. record the outcome; a thrown error is recorded and the loop continues (FR-025).
11. Print the summary (FR-040); release the lock; exit 0 or 2 (FR-004).
```

Ordering note: assignment comes **after** branch preparation and **before** the marker comment. Preparing first means a skipped item never leaves a misleading claim on GitHub; assigning before the marker means the visible claim and the boundary record land in the order a human reading the issue would expect.

Reconciliation runs **before** link repair and before the loop advances, and it runs even when the executor threw — otherwise a crashed run would leave a permanent "working…" comment with no explanation, which is exactly the state an operator cannot diagnose.

The command file contains no detection logic and no `gh` invocation of its own — it sequences the modules above.

### 10. CLI configuration (`src/commands/config.ts`)

- `config set do-work-base-branch <value>`
- `config set do-work-executor <claude|codex>`
- `config set do-work-model <value>`
- `config set do-work-max-runs <n>`
- `config set do-work-lock-stale-minutes <n>`
- `config set do-work-prompt <turn-kind> <value>` — `turn-kind` is `issue-discuss` or `pr-work`; the value is prompt text or a `.md` filename

Each reads the raw config, merges into `doWork`, and writes it back, matching the existing `config set` subcommands. Invalid turn kinds, non-numeric values and unknown executors are rejected with exit 1.

### 11. Wizard (`src/config/ConfigWizard.tsx`)

A `Do Work` entry appended last to `MAIN_MENU_OPTIONS` (so existing menu indices and their navigation tests are unaffected), leading to: base branch → executor → run cap, then save and exit. Two entries appended last to `PROMPTS_MENU_OPTIONS`, `Do Work — Discuss` and `Do Work — PR`, each pre-filled with the built-in default, writing `.automata/do-work-issue-discuss.md` / `.automata/do-work-pr-work.md` and storing the filename — exactly like the existing prompt screens.

### 12. Documentation

`docs/do-work.md` follows the shape of the existing reference pages (synopsis, options table, required configuration, how it works, detection rules, exit codes) and links to the wiki for the process.

The wiki carries what no reference page can:

- **Home** — what the harness is, the one-paragraph model (authorized humans talk, the agent answers, cron ticks), when *not* to use it, and the page map.
- **Concepts** — the actors (authorized accounts, the agent identity, ignored accounts), the two surfaces, what counts as a message, the agent boundary, the two turn kinds, and the role of assignment versus the marker comment.
- **Issue-Lifecycle** — one issue walked tick by tick: description → discuss turns → go-ahead → branch and PR → review rounds → human merge, with the GitHub-visible state at each step (labels, assignee, marker comments, `Closes #N`) and an ASCII state diagram.
- **Detection-Rules** — the authorization filter, the boundary rule with the strict-inequality tie, the unresolved-thread rule, the PR-existence rule, the merged-PR rule, and the full decision table copied from this plan.
- **Setup** — the isolated VM or codespace, `gh` authentication, choosing and provisioning the agent account (write access, so assignment works), the label, `allowedUsers`/`agentUser`, the `doWork` section, a first `--dry-run`, and the cron entry with a note on interval versus tick length.
- **Prompts** — the contract: automata supplies the context block and guarantees its shape; the configured prompt owns the instructions and is where a skill is named. Includes the shipped defaults, a worked example that names a skill, and the rule that an unresolvable prompt file fails the tick.
- **Operations** — running under cron, the run lock and what a contended tick looks like, exit codes 0/1/2 and how to read them from cron mail, the run cap, and a "what the harness never does" list (no merge, no issue closure, no push to the base branch, no action on unauthorized messages, no permission prompts — hence disposable environments only).
- **Troubleshooting** — symptom → cause → fix, covering at minimum: nothing happens; the same message is answered twice; the agent answers its own messages; an issue stays in discussion after a go-ahead (the missing closing reference); items are skipped (dirty tree, branch preparation); assignment fails; the tick never starts (stale lock).
- **Roadmap** — deferred by design: the Azure DevOps backend, a landing step, bot-reviewer turns, and skills as a separate concern.

### 13. Testing strategy

The decision core is pure, so the table in §4 is tested directly and exhaustively without a `gh` binary:

- `conversation.test.ts` — boundary from the newest agent message; `issue-body` excluded from the boundary; first-run behaviour; agent messages never new even when the agent is listed as allowed; unauthorized authors dropped from detection *and* output; case-insensitive logins; strict-inequality ties; `lastAuthorClass` for each class.
- `workDetection.test.ts` — `agentAnsweredAfter()`: an agent message newer than the marker → true; the marker itself → false; an agent message older than the marker → false; an authorized human's newer message → false; a thread reply by the agent → true; an exact timestamp tie → false. Plus one case per row of the decision table, and: merged PR treated as absent; both surfaces new → one `pr-work` item carrying both; unresolved thread whose last comment is the agent's → not actionable; unresolved thread whose last comment is a bot's → not actionable; resolved thread with a new authorized comment → not actionable; several open linked PRs → newest chosen, rest reported; `needsAssignment` true when the agent is absent from the assignees and false when present, case-insensitively.
- `workPrompt.test.ts` — the configured frame appears first and verbatim; every required context field present for both turn kinds; PR fields absent for discuss; new messages under their own heading; unauthorized content absent; the shipped default frames carry the turn boundary and name no skill.
- `runLock.test.ts` — acquire on a clean directory; contention against a live pid; reclaim of a lock whose pid is dead; reclaim of a lock older than the staleness window; unparseable lock reclaimed; idempotent release.
- `ghWorkService.test.ts` — `spawnSync` mocked: `postMarker` returning the id and `created_at` from the REST response; `updateMarker` issuing `PATCH`; `deleteMarker` issuing `DELETE` and treating 404 as success; link-map inversion; an issue closed by two open PRs; `author.login` flattening; chronological sorting; empty review bodies dropped; assignees normalised; `assignIssueToAgent` issuing `--add-assignee`; non-zero `gh` status surfaced; `gh` missing reported clearly.
- `workspaceService.test.ts` — dirty tree refused before any git mutation; base and head branch preparation; head branch created from the remote when absent locally; `--ff-only` failure surfaced as `pull-failed`.
- `doWork.cmd.test.ts` — services and executors mocked: each precondition failure exits 1 (including an unresolvable prompt); nothing-to-do exits 0 with nothing assigned, nothing posted and no executor spawned; three items run sequentially; a failing item does not abort the tick and forces exit 2; a skipped item forces exit 2; `--dry-run` assigns nothing, posts nothing and spawns nothing; `--json` shape; `--max-runs` defers; lock contention exits 0 with no GitHub call; assignment skipped when already assigned; assignment failure warns and the turn proceeds; the marker posted after assignment and before the executor; a marker failure skips the item; the marker deleted when the agent answered and never otherwise; the marker updated in place when no answer was produced; reconciliation running after a thrown run; a delete failure warned about while the item still counts as answered; an update failure warned about while the outcome is unchanged; `--dry-run` deleting and editing nothing; link repair only after a discuss turn; `--with`, `--model` and `--silent` forwarded.
- `issueConversation.test.ts` is left byte-identical — it is the regression proof for the §2 refactor.

### 14. Dogfooding

Once the tick is green, this repository configures its own `doWork` section and writes its two prompts in `.automata/` — and *those* prompts are where a skill gets named, exercising the contract published in `docs/wiki/Prompts.md`. The loop is then run for real: `automata do-work --dry-run` first, then a discuss turn on a labelled issue, then a `pr-work` turn against review feedback on this feature's own pull request.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| One command orchestrates discovery, detection, claiming, branch preparation and execution (principle III prefers one thing per command) | The whole value of the feature is that the *decision* of what to answer next lives in the tool instead of in a human or a model. Splitting it would put the state machine back in the caller — a cron line or a shell script — which is exactly the cost this feature removes | Composing existing commands from a shell wrapper: rejected because the wrapper would need to read the issue↔PR link, compute the agent boundary and choose the turn, i.e. reimplement the whole feature in bash with no tests |
| A `doWork` configuration section instead of flags (principle V prefers flags) | The base branch and executor are stable per-repository facts a cron line must not restate, and the per-turn prompts are multi-paragraph text that cannot live on a command line at all. Every field has a working default, so the minimal configuration is empty | Flags only: rejected because prompt text cannot be passed as a flag, and an unattended cron entry would become the de-facto configuration file with no validation, no wizard and no defaults |
| A new `ghWorkService.ts` alongside the existing `githubService.ts` and `gitService.ts` | `gitService.ts` is already 981 lines, and `do-work`'s queries differ materially from the existing ones (whole-set PR link map; review threads with *all* comments rather than the first) | Extending the existing modules: rejected because changing the shared review-thread query would alter `execute-prompt fix-comments` behaviour, which FR-003 forbids |
| Refactoring `issueConversation.ts` while FR-003 forbids touching existing commands | `do-work` needs the identical rules over three message collections, and duplicating them would guarantee the two copies diverge on the exact rule that keeps the loop from re-triggering itself | Copy the rules into `do-work`: rejected as a correctness hazard. The mitigation is that the public API is preserved and the existing test file is left untouched as proof |
| A nine-page wiki for one command | The deliverable is a process, not a command; the existing reference-page format cannot carry lifecycle, trust model or operational guidance, and an unattended loop nobody can reason about gets switched off after the first surprise (FR-045, SC-011) | A longer `docs/do-work.md`: rejected because it would mix reference and narrative in one page, breaking the documentation convention in `AGENTS.md` and making both harder to keep accurate |
