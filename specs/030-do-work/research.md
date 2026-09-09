# Research: `do-work` Autonomous Orchestrator

**Feature**: `specs/030-do-work/` | **Date**: 2026-09-09

## R1 — How to resolve the issue → pull request link in one call

**Question**: Given a set of open issues, which of them have an open pull request attached, without one API call per issue?

**Finding**: GitHub's GraphQL API exposes `PullRequest.closingIssuesReferences`, which is derived from the closing keywords in the PR body (`Closes #N`, `Fixes #N`, …) and from manual UI links. Querying open pull requests once and inverting the mapping gives the issue → PR direction for the whole set.

Verified against this repository:

```bash
gh api graphql -f query='query {
  repository(owner:"alkampfergit", name:"automata-cli") {
    pullRequests(states:OPEN, first:100) {
      nodes { number closingIssuesReferences(first:5) { nodes { number } } }
    }
  }
}'
# => {"data":{"repository":{"pullRequests":{"nodes":[
#      {"number":31,"closingIssuesReferences":{"nodes":[]}},
#      {"number":32,"closingIssuesReferences":{"nodes":[]}}]}}}}
```

**Decision**: One GraphQL query per tick over open pull requests, selecting `number`, `url`, `title`, `updatedAt`, `headRefName`, `isDraft` and `closingIssuesReferences`. Build a `Map<issueNumber, PullRequestRef[]>`.

**Why not the alternatives**:

- `gh issue view N --json closedByPullRequestsReferences` exists but costs one call per issue and does not return the head branch.
- Searching PR bodies for `Closes #N` would reimplement, less accurately, what `closingIssuesReferences` already computes and would miss UI-created links.
- The issue timeline (`CROSS_REFERENCED_EVENT`) also reports mere mentions, which are not links.

**Consequence**: `implement-next`'s existing `addClosesRefToPr()` is what creates the link today, so repositories already using automata keep working. This is also why FR-034 repairs a missing closing reference — without it, a PR the model opened by hand would be invisible to the state machine.

## R2 — Detecting an unresolved review thread that still needs an answer

**Question**: The existing `getPrCommentsGh()` in `src/git/gitService.ts` requests `comments(first:1)` per review thread, i.e. only the thread's *opening* comment. Is that enough for `do-work`?

**Finding**: No. `do-work` must know whether the agent has already replied *inside* the thread. A thread whose opening comment is from a maintainer but whose last comment is the agent's reply is answered, even while `isResolved` is still false (resolving is the reviewer's action, not the agent's). With only the first comment, every unresolved thread would retrigger a turn forever.

**Decision**: Add a separate GraphQL query for `do-work` that fetches `isResolved`, `isOutdated`, `path`, `line` and `comments(last:100)` with author, body and `createdAt` per thread. Leave `getPrCommentsGh()` untouched so `execute-prompt fix-comments` keeps its current behaviour.

**Rule**: a thread needs an answer when `isResolved == false` **and** the newest comment's author is in `allowedUsers` and is not `agentUser`.

## R3 — Top-level pull request conversation comments

**Question**: Are PR conversation comments reachable the same way as issue comments?

**Finding**: Yes. In GitHub's model a pull request is an issue, so `gh pr view N --json comments` returns the top-level conversation comments with `author.login`, `body` and `createdAt` — the same shape `getIssueConversation()` already normalises. Review *summaries* (`reviews`) are a separate collection; they carry a body only when the reviewer wrote one.

**Decision**: Fetch `gh pr view <n> --json number,title,url,headRefName,state,isDraft,body,author,createdAt,comments,reviews` and treat conversation comments and non-empty review bodies as messages on the PR surface. Inline threads come from R2's query.

## R4 — Reuse of the existing conversation analysis

**Question**: Can feature 029's `analyzeConversation()` be reused, or does `do-work` need its own?

**Finding**: The rules are identical (agent boundary = newest agent comment; new = authorized, non-agent, strictly newer; non-participants dropped) but the input type is nailed to `IssueConversation`. `do-work` needs the same rules over three different collections (issue comments, PR comments, review threads).

**Decision**: Extract the rules into a small, remote-agnostic pure module operating on a generic message list, and keep `analyzeConversation()` as a thin wrapper over it so feature 029 and its tests are unaffected. This is a refactor with no behaviour change, and it is the only place where `do-work` touches existing code.

## R5 — Preventing concurrent automata instances

**Question**: How should a tick guarantee no other automata instance is working in the same repository?

**Finding**: The tick is long (one or more full model sessions) and cron fires on a fixed interval, so overlap is the normal case, not the exception. Two model sessions in one checkout would fight over the branch and push conflicting commits. Node has no portable advisory file lock, but an exclusive create (`open` with `wx`) is atomic on every platform we target, and liveness can be checked with `process.kill(pid, 0)`.

**Decision**: `.automata/automata.lock` written with `flag: "wx"` containing `{ pid, startedAt, host, command }`. The file is named for automata as a whole, not for `do-work`, so other long-running commands can adopt the same lock later without a second format; in this feature only `do-work` acquires it. On `EEXIST`, read it: if the pid is alive and `startedAt` is within the staleness window, exit 0 with "another tick is running"; otherwise reclaim it. Release in a `finally` and on `SIGINT`/`SIGTERM`. The lock file goes in `.automata/`, which `.gitignore` must cover. It is acquired before any state-changing GitHub call, so a contending instance neither assigns an issue, nor posts a marker, nor starts a model.

**Why not the alternatives**: a `git` index lock is unrelated and would break other tooling; a remote lock (a GitHub label) would survive a crash and cost API calls.

## R6 — Bot reviewers

**Question**: Should Copilot and SonarCloud comments drive turns?

**Finding**: They are the highest-volume comment source on a PR and each of their rounds can produce a fresh comment after every push, so including them makes an unattended loop that can spin. automata already has two purpose-built commands for exactly this — `execute-prompt sonar` and `execute-prompt fix-comments`.

**Decision**: `do-work` filters strictly to `allowedUsers`, which excludes bots by construction. Getting a PR to green on bot feedback stays the job of the specific commands (and, later, of a skill that a build turn may choose to invoke).

## R7 — Talk-versus-build without a classifier call

**Question**: How is the phase decided without spending a model call on classification?

**Finding**: The presence of a linked open pull request is a perfect, observable proxy: before the go-ahead there is no PR; the act of implementing creates one. Nothing else needs to be inferred, and the state is visible to humans in the GitHub UI.

**Decision**: `linkedOpenPr == null` → `issue-discuss` (no file modification allowed); otherwise → `pr-work` on the PR head branch. The discussion skill is what escalates: when an authorized message says "implement it", the skill creates the branch, implements and opens the PR. FR-034 guarantees the link exists afterwards, so the next tick sees a build turn.

**Consequence**: a discuss turn's hard "do not modify files" boundary cannot be absolute — the escalating turn *does* write code. The boundary is therefore expressed as: do not modify files **unless** an authorized message in this turn asks you to implement, in which case create the branch and pull request. This wording lives in the prompt frame (FR-032) and is the one place the two phases meet.

## R8 — Where the turn instructions come from

**Question**: How does the model receive the how-to for a turn?

**Finding**: automata has no need to know what a skill is. The executors (`claude -p`, `codex exec`) already load whatever skills are installed in the environment and will use one when the prompt names it. So the smallest thing that works is: automata assembles the context it alone can produce, and the *instructions* are prompt text held in configuration — text that may name a skill, or not.

**Decision**: `doWork.prompts.issueDiscuss` and `doWork.prompts.prWork` hold the turn instructions, as inline text or a `.md` filename resolved by the existing `resolvePromptRef()`. Built-in defaults ship with the CLI and name no skill, so the harness works with nothing installed. The configured prompt is placed first and verbatim; automata appends its context block after it. This feature authors no skills.

**Consequence**: agent behaviour is changed by editing a file in `.automata/`, with no CLI release. It also means an unresolvable prompt reference must be **fatal** for `do-work` (FR-007) rather than falling back to the default — on an unattended loop a silent fallback would change agent behaviour invisibly, which is worse than a refused tick.

**Why not the alternatives**:

- A skill-name mapping in configuration (`doWork.skills.*`): rejected — it makes automata model a concept it does not own, and a prompt can already name a skill in one line while also carrying the turn's constraints.
- automata shipping only skills: rejected — it would make the tool depend on a plugin being installed, so a fresh container could silently do the wrong thing.

## R9 — Executor invocation and permissions

**Question**: Which invocation mode should `do-work` use?

**Finding**: `invokeClaudeCode()` supports a verbose streaming mode (`--verbose --output-format stream-json`) and a plain `-p` mode; `invokeCodexCode()` uses `codex exec`. The existing `execute-prompt` subcommands already pass `yolo: true` unconditionally, because a prompt-driven run cannot answer a permission prompt.

**Decision**: reuse both services unchanged, always with `yolo: true`, streaming by default and plain output under `--silent`. Document the isolation requirement (FR-043) rather than adding an option that would make unattended use fail silently.

**Note**: `MODEL_IDS` in `src/claude/claudeService.ts` still maps `opus`/`sonnet` to `claude-opus-4-6` / `claude-sonnet-4-6`. `do-work` passes `--model` straight through and does not depend on that table; refreshing it is out of scope here.

## R10 — Exit codes for an unattended loop

**Question**: What should cron see?

**Decision**: `0` — tick completed, including "nothing to do" and "another tick is running"; `1` — precondition or configuration failure, nothing was attempted; `2` — the tick ran but at least one item failed or was skipped. This keeps a healthy idle loop quiet while making a misconfigured loop and a degraded loop distinguishable in cron mail.

## R11 — Claiming an issue visibly

**Question**: `do-work` already posts a marker comment. Why also assign the issue, and what does assignment cost?

**Finding**: The two mechanisms answer different questions. The marker comment is the *boundary record* — it is what stops the same message being answered twice, and it must therefore be verified before the model runs. Assignment is the *visible claim* — it is what a human scanning the issue list sees, and it is what makes "the agent is working on this" legible without opening the thread.

`gh issue edit <n> --add-assignee <login>` is additive: it does not remove an existing assignee, so an issue triaged to a human keeps that assignment and gains the agent. `gh issue view --json assignees` returns the current assignees, so the check costs nothing extra — the issue surface already fetches it.

**Decision**: assign before the first model run on an issue, only when the agent is not already among the assignees, and treat a failure as a warning rather than an abort. Assignment requires the agent account to have write access on the repository; when it does not, the loop still works, so refusing the turn over it would stall everything on a permissions detail that does not affect correctness. The marker comment keeps the opposite policy: a failure there aborts the item.

**Interaction with discovery**: when `issueDiscoveryTechnique` is `assignee`, self-assignment keeps the issue inside its own discovery filter, which is consistent. When it is `label` (the common case) assignment is pure signalling.

## R12 — Where the process documentation belongs

**Question**: The repository documents each command group in a terse `docs/<group>.md` reference page (`AGENTS.md` documentation convention). Where does a *process* explanation go?

**Finding**: There is no conceptual documentation anywhere in the repository today — all six `docs/*.md` pages are option-and-exit-code references, and `README.md` is deliberately small. The repository's GitHub wiki is enabled (`has_wiki: true`) but empty. A process this feature introduces — a trust model, a two-phase lifecycle, a cron-driven loop with safety boundaries — cannot be carried by a reference page without breaking the convention that makes those pages useful.

**Decision**: author the wiki in-repo under `docs/wiki/`, with one page per concern and filenames that map to GitHub wiki page names, so the directory can be published verbatim to the repository wiki. In-repo is what keeps it honest: the wiki is reviewed in the same pull request as the behaviour it describes, and T050 cross-checks every stated rule against the code.

**Division of labour**: `docs/do-work.md` stays a reference (synopsis, options, exit codes) and links to the wiki for the process; the wiki links back for exact option semantics. Neither restates the other, so each fact has exactly one home.

## R13 — Reconciling the working marker after a run

**Question**: The marker exists to hold the boundary during a run. Once the run is over, the model has usually posted its own answer — so what happens to the marker, and how is "the model answered" established?

**Finding on identity**: to edit or delete a comment later, its id is needed. `gh issue comment` and `gh pr comment` do not return it usably — the existing `postComment()` in `githubService.ts` scrapes a URL out of stderr, which is enough to build a REST path but gives no creation timestamp. Posting through `gh api repos/{owner}/{repo}/issues/{n}/comments` instead returns JSON carrying both `id` and `created_at`. Because a pull request *is* an issue in GitHub's model, the same endpoint covers both surfaces, and `PATCH`/`DELETE .../issues/comments/{id}` then works for either — one implementation, not two.

**Finding on detection**: "the model answered" must be established by re-reading the surface, not inferred from the executor's exit code. The two are independent: a run can exit non-zero after having posted a perfectly good reply, and a run can exit zero having posted nothing. The predicate is: a message authored by the agent, created strictly after the marker, that is not the marker. On a pull request the search must include review-thread comments, because replying inside the thread is the natural way to answer a line-level review and requiring an additional top-level comment would only make the model post noise.

**Decision**:

- Answer confirmed → delete the marker. The model's own message is newer, so it takes over as the boundary and the marker is pure noise.
- No answer → update the marker in place, reporting that the run finished or failed and produced no reply.

**Why deletion must be guarded**: the marker is the boundary. Deleting it without a newer agent message would move the boundary back behind the human's message, and the next tick would answer the same message again — the exact failure the marker was introduced to prevent. So the delete is conditional on the predicate and never on the exit code.

**Why the update must not delete**: `PATCH` leaves `created_at` untouched, so an updated marker still holds the boundary and the failing run is **not** retried automatically. This is deliberate: an unattended loop that retries a failing run on every firing burns model calls indefinitely on the same broken input. The updated text is therefore the only channel that tells an authorized human that a reply is needed, which is why an update failure is warned about loudly rather than silently.

**Consequence for the conversation**: a healthy finished conversation contains only human messages and real agent answers — no leftover "working…" comments — while every run that produced nothing has left exactly one marker explaining itself (SC-003).
