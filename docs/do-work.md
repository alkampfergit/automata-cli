# automata do-work

Run one tick of the autonomous loop over the repository in the current directory.

A tick finds the open issues whose newest message from an **authorized account** the agent has not answered — on the issue or on its pull request — and answers them, one model run each. It is designed to be run from cron in a disposable VM or container.

For the process itself — the trust model, how an issue travels from a description to a merged pull request, how to set the harness up and operate it — read the [wiki](wiki/Home.md). This page is the command reference.

> **`do-work` runs the executor with permission prompts bypassed.** An unattended run cannot answer a prompt. Run it only in an isolated, disposable environment. See [wiki/Operations.md](wiki/Operations.md).

```bash
automata do-work                    # one tick
automata do-work --dry-run          # show the work plan, change nothing
automata do-work --issue 42         # restrict the tick to one issue
automata do-work --json             # machine-readable plan and outcomes
```

---

## Options

| Option | Description |
|---|---|
| `--with <executor>` | Executor to use: `claude` or `codex`. Default: `doWork.executor`, else `claude`. |
| `--model <string>` | Model identifier passed to the executor, overriding the configured default for it. Default: `doWork.models.<executor>`, else the executor's own default. |
| `--effort <level>` | Reasoning effort passed to the executor, overriding the configured default for it. Default: `doWork.effort.<executor>`, else the executor's own default. |
| `--issue <number>` | Process only this issue. Detection rules still apply; a warning is printed if the issue does not match the discovery filter. |
| `--limit <n>` | Maximum issues to fetch (default: `10`). A note is printed when the result was truncated. |
| `--max-runs <n>` | Maximum **model runs** this tick — an item skipped for a dirty tree, a failed marker, or because it stopped being actionable does not consume a slot. Remaining items are reported as `deferred`. Default: `doWork.maxRunsPerTick`. |
| `--dry-run` | Print the pre-flight plan and the work plan, then a summary and the exact command that would be launched for each item, and stop. Nothing is rescued, pruned, pulled, assigned, posted, edited, deleted, checked out or invoked. |
| `--json` | Emit the plan and per-item outcomes as JSON on stdout; human-readable progress goes to stderr. |
| `--silent` | Suppress step-by-step Claude output. Affects printing only — the executor is always spawned the same way, so the command `--dry-run` shows is what runs. Ignored by Codex. |

The directive in the newest triggering message takes precedence over the command-line options, which take precedence over the `doWork` configuration section, which takes precedence over the built-in defaults. Only the executor and the model can be named in a message; the reasoning effort follows whichever executor ends up running — see [Steering one turn from a message](#steering-one-turn-from-a-message).

### Executor, model and effort defaults

`do-work` always invokes the executor with **permission prompts bypassed** — an unattended run cannot answer a prompt, so there is no option to change this. It defaults to **Claude**, and Codex is selected with `--with codex` or `doWork.executor`.

Model defaults are held **per executor**, because a Claude model identifier is not a valid Codex model and vice versa:

```json
{ "doWork": { "executor": "claude", "models": { "claude": "claude-opus-4-6", "codex": "o3" } } }
```

Resolution for one run is: `model:` in the triggering message if present, else `--model` if given, else the default for the executor actually being used, else nothing (the executor picks its own). So `--with codex` on the configuration above sends `o3`, never the Claude identifier.

**Reasoning effort** is held per executor for the same reason, under `doWork.effort`, and resolves the same way — `--effort` if given, else `doWork.effort.<executor in use>`, else nothing:

```json
{
  "doWork": {
    "executor": "claude",
    "models": { "claude": "claude-opus-5", "codex": "gpt-5.1-codex-terra" },
    "effort": { "claude": "high", "codex": "medium" }
  }
}
```

The two executors express the level differently, and `do-work` handles the difference for you:

| Executor | What is spawned |
|---|---|
| `claude` | `--effort <level>` |
| `codex` | `-c model_reasoning_effort="<level>"` — codex has no effort flag, so the level goes through its config-override option. `-c` parses its argument as TOML, so the level is emitted as a TOML basic string: a quote or backslash in the value is escaped rather than ending the string early |

automata does not validate the level. The valid set is executor- *and* model-specific — `claude` takes `low`, `medium`, `high`, `xhigh` or `max`; `codex` takes `minimal`, `low`, `medium` or `high`, plus `xhigh` on max-class models — and it moves between executor releases, so an allow-list here would reject a level your installed executor accepts. The value is forwarded unchanged apart from surrounding whitespace, which is trimmed off both `--effort` and `doWork.effort.<executor>` — an untrimmed `" high "` is an unknown level, and neither executor reports one (see below). Only an empty level is refused, since it would emit a flag with no operand.

**Neither executor errors on an unknown level**, so a typo is quiet rather than fatal: `claude` prints `Warning: Unknown --effort value '<x>' — ignoring it and using the default effort.` and carries on, and `codex` forwards the value to the API and shows it as `reasoning effort: <x>` in its session header. Check that header, or Claude's warning, if a level does not seem to be taking effect.

A `tool:` directive that switches executor re-picks **both** the model and the effort for the executor it switched to, dropping `--model` and `--effort` along with them — see [Steering one turn from a message](#steering-one-turn-from-a-message).

---

## Steering one turn from a message

An authorized account can pick the executor and the model for the turn its message triggers, by writing a directive anywhere in the message body:

| Directive | Effect |
|---|---|
| `tool:claude` / `tool:codex` | Run this turn with that executor. |
| `model:<id>` | Pass that model identifier to the executor. |

```text
This one needs a second opinion — tool:codex model:gpt-5-codex

Please rework the retry logic so it backs off exponentially.
```

- Only the **newest** authorized message the turn is answering is read — the issue comment, the pull request comment or review, the unresolved review-thread comment, or the issue description on a first turn. A directive in an older message is ignored.
- Therefore a directive **never persists**. Every tick re-reads whichever message is newest then, and a message without a directive resolves to the ordinary defaults.
- Matching is case-insensitive and works anywhere in the body. If a key appears more than once, the **last** occurrence wins.
- A key must not be preceded by a word character, a hyphen or a colon, so `mytool:codex` and `no-tool:codex` are not directives.
- `tool:` **without** `model:` uses `doWork.models.<the executor you asked for>`. A `--model` passed for the executor that was going to run is dropped when the directive switches executor, for the same reason the defaults are held per executor: a Claude identifier is not a valid Codex model.
- The **reasoning effort** follows the executor the same way, even though no `effort:` directive exists: a switch drops `--effort` too and falls to `doWork.effort.<the executor you asked for>`, else nothing. The two executors accept different level names, so carrying `high` from a Claude default onto `codex` would be as wrong as carrying the model.
- A `model:` value is **not validated** — automata cannot hold either executor's model catalogue. If the executor rejects it, that surfaces as an ordinary run failure.
- The directive is **not stripped** from the conversation handed to the executor.
- `automata implement-next` does not read directives; this is a `do-work` behaviour only.

### An unrecognised `tool:` value refuses the run

`tool:codexx` does not fall back to the default. Falling back would produce a Claude answer that the maintainer reads as a Codex answer, so the item is refused instead: no executor is invoked, the item is reported as `failed` (so the tick exits 2), and the `working…` marker is replaced with

> automata do-work: the newest message asks for `tool:codexx`, which is not an executor automata knows (valid values are `claude` and `codex`). No run was started. Reply here with a corrected directive, or none at all, to have another attempt made.

The refusal happens *after* the marker is posted, which is what advances the answer boundary — otherwise the mistyped message would stay new and be re-refused on every later tick. It does not consume a slot from the run cap, and the other items in the same tick are unaffected.

---

## Required configuration

`do-work` refuses the tick (exit 1) unless all of these are set:

| Key | Set with | Purpose |
|---|---|---|
| `remoteType` | `automata config set type gh` | Must be `gh`. Azure DevOps is unsupported — see [docs/azdo-gap.md](azdo-gap.md). |
| `issueDiscoveryTechnique` | `automata config set issue-discovery-technique label` | How to find candidate issues. |
| `issueDiscoveryValue` | `automata config set issue-discovery-value automated` | The label name, assignee, or title fragment. |
| `allowedUsers` | `automata config set allowed-users alice,bob` | The only accounts whose messages can trigger a turn or reach a prompt. |
| `agentUser` | `automata config set agent-user automata-bot` | The login the agent posts as. Defines the answer boundary. |

`do-work` also refuses (exit 1) whenever `gh` is authenticated as an account that is **not** `agentUser`. Everything the agent posts is attributed to whoever `gh` is authenticated as, and both mismatches are fatal for the same underlying reason — the answer boundary stops working:

- **The login is in `allowedUsers`** — the agent's own marker reads as a new instruction, so every tick answers the previous tick's marker forever.
- **The login is neither the agent nor authorized** — the marker and the model's reply are filtered out of the conversation entirely, so the boundary never advances and the same human message starts a run on every tick.

A login that cannot be determined is accepted with a warning, because a GitHub App installation token legitimately has no user. Authenticate `gh` as the agent account in the harness environment.

The guard applies to real ticks only. `--dry-run` posts nothing, so there is no identity to protect and the plan can always be inspected from a workstation.

Everything under `doWork` is optional and has a working default — see [docs/config.md](config.md#dowork).

---

## How it works

One tick, in order:

1. **Validate** the configuration, resolve both turn prompts, and check that `gh` is not authenticated as an account that may instruct the agent. Any problem exits 1 before anything happens.
2. **Take the run lock** (`.automata/automata.lock`). If another automata instance holds it, print a message and exit 0 without touching GitHub.
3. **Run the repository-hygiene pre-flight** — rescue uncommitted changes, check out and fast-forward the base branch, prune dead local branches. See [the pre-flight](#the-repository-hygiene-pre-flight) below. It runs on every tick, including one with nothing to do.
4. **Discover** candidate issues with one `gh issue list`, then resolve every open pull request's closing references with a paginated GraphQL query. Every page is read, and if the map cannot be read completely the tick **fails** rather than continuing: callers treat absence from it as proof that an issue has no pull request, so a partial map is a wrong answer, not a degraded one. Review threads are paginated for the same reason — feedback past thread 100 would otherwise be invisible to both detection and the prompt.
5. **Decide** a turn per issue (see below) and print the work plan. `--dry-run` stops here.
6. **Process** each work item sequentially:
   1. re-read the issue **and its pull-request link** and re-decide the turn. The plan was built before any model ran, and an earlier item can take a long time; a message arriving in the meantime has to be answered rather than buried behind the marker about to be posted, and a pull request opened in the meantime has to switch the turn to `pr-work` rather than starting a competing implementation. An item that stopped being actionable is skipped here, and the summary reports the turn that actually ran;
   2. check out the branch the turn needs (base branch for a discuss turn, the pull request's head branch for a build turn);
   3. assign the issue to the agent, if it is not already assigned;
   4. post a `working…` marker comment. On a build turn triggered by *issue* messages, also leave a permanent note on the issue pointing at the pull request — the two surfaces keep separate boundaries, so answering on the pull request would otherwise leave that issue comment new forever. The marker is posted first and withdrawn if the note cannot follow it, so either both land or neither does;
   5. invoke the executor;
   6. reconcile the marker — delete it if the agent posted an answer, update it in place to say what happened if it did not, and say the answer could not be verified if the surface could not be re-read;
   7. after a discuss turn only, and only if the turn actually moved off the base branch, make sure the new pull request closes the issue.
7. **Summarise** and exit.

---

## The repository-hygiene pre-flight

Every tick starts by putting the checkout into a known state, once, inside the run lock and before anything is read from GitHub. Three steps, always in this order.

### 1. Rescue uncommitted changes

If the working tree has uncommitted changes — modified, staged, deleted or untracked, ignoring only `.automata/automata.lock` — they are committed and pushed instead of being left to make every work item skip with `dirty-tree`.

- The checkout is **on a branch other than the base branch** → the changes are committed onto that branch and pushed. A draft pull request is opened only if that branch does not already have an open one.
- The checkout is **on the base branch, or on a detached HEAD** → a `rescue/<source>-<YYYYMMDDTHHMMSSZ>` branch is created at HEAD first, then committed, pushed and given a draft pull request. `do-work` never commits to or pushes the base branch.

The commit message is `chore(automata): rescue uncommitted work from <source>`. The run lock is excluded from the commit, so a tick does not commit the lock file naming its own pid.

Every step is additive, so a failure at any of them leaves the tree exactly as dirty as it was and discards nothing; the tick then continues with the pre-existing per-item `dirty-tree` skip.

### 2. Check out and fast-forward the base branch

`git checkout <base>` then `git pull --ff-only`, on every tick — a tick with nothing to do still leaves the checkout on the base branch at the remote's tip. A base branch that has diverged fails the pull loudly rather than being merged, rebased or reset.

### 3. Prune dead local branches

A local branch is a **candidate** when its name does not exist on `origin` (resolved with one `git ls-remote --heads origin`, not one call per branch). The base branch, the branch currently checked out and every branch in `doWork.protectedBranches` are never candidates.

For each candidate:

| State | Action |
|---|---|
| Has an `OPEN` pull request | Kept. |
| Has a `MERGED` pull request | Deleted (`git branch -D`). The merge is proof the work landed; the commit count is not consulted. |
| No pull request, or only ones closed without merging, **and** no commit outside the base branch | Deleted. |
| No pull request, or only ones closed without merging, **but** commits the base branch does not have | Pushed, given a draft pull request, and **kept**. |
| Its pull requests, or its commit count, could not be read | Kept, and the tick is reported as degraded. |
| Pushed, but the draft pull request could not be opened | Kept. The commits are safe on `origin`, but the tick is reported as degraded so the missing pull request is not silently forgotten. |

**A branch is deleted only on proof that its work landed** — either a merged pull request, or a confirmed zero unmerged commits from `git rev-list --count <base>..<branch>`.

The merged-pull-request rule comes first because this repository squash-merges: the change is in the base branch while *none* of the branch's own commits are, so reachability is highest for exactly the branches that are safest to delete. `git branch -d` is not used for the same reason — it refuses a squash-merged branch. A pull request closed *without* merging is not evidence of anything, so those branches fall through to the commit count.

Every uncertainty keeps the branch: an unreachable `origin` means no branch can be shown to have no remote, so the whole step does nothing.

### Pull requests the pre-flight opens

Always a **draft** against the base branch, labelled `rescue` (best-effort — a repository that has not defined the label still gets the pull request), with a body naming the pre-flight as its author. They reference no issue and request no reviewer, which is also why they can never be picked up as an issue's pull request: work detection maps pull requests to issues through closing references, and these deliberately have none.

### Reporting

Progress goes to stderr as each step runs, and the outcome is repeated in the tick summary on stdout:

```text
Pre-flight:
  rescue committed and pushed feature/031-update-all-npm, PR #44 already open
  base   ready
  prune  deleted feature/old-thing
  prune  kept fix/wip (open-pr: PR #12 is open)
  prune  rescued wip/scratch (pushed, draft PR #52)
```

Under `--json` the same information is a `preflight` object alongside `plan` and `items`. Under `--dry-run` every step reports what it *would* do and issues no commit, push, pull, branch creation, branch deletion or pull-request call.

A pre-flight step that failed makes an otherwise-healthy tick **exit 2** — see [exit codes](#exit-codes).

---

## Inspecting a tick without running it

`--dry-run` prints the work plan and then, per item, a summary header and the exact command that would be launched:

```text
────────────────────────────────────────────────────────────────────────
Issue #42 — Add a flag
────────────────────────────────────────────────────────────────────────
  Turn         issue-discuss
  Why          1 new issue message, no open pull request
  Branch       develop (would check out and pull)
  Assign       would assign to automata-bot
  Marker       would post on issue #42
  Executor     claude · model claude-opus-4-6
  Permissions  bypassed (do-work always runs unattended)
  Prompt       1443 chars — frame + assembled context

  Command that would be launched:
────────────────────────────────────────────────────────────────────────
/path/to/claude --dangerously-skip-permissions --model claude-opus-4-6 --verbose --output-format stream-json -p 'You are the agent…'
────────────────────────────────────────────────────────────────────────
```

The command is built by the same argv builders the real invocation uses, so it cannot drift from what a real tick would spawn, and it is shell-quoted so it can be pasted and run by hand. It is printed **unindented** on purpose: the prompt is a multi-line quoted argument, so indenting the continuation lines would add whitespace to the prompt the command actually sends.

`--dry-run --json` returns the same information as data — including `args` (the raw argv), `command`, and the full `prompt` — which is the easier form for diffing a prompt change.

`--dry-run` respects the run cap, and reports how many items it did not describe.

When the choice came from a message the `Executor` line says so, and an item a real tick would refuse shows the refusal instead of a command:

```text
  Executor     codex · model gpt-5-codex · effort medium — from the message
```

```text
  Executor     refused — the newest message asks for `tool:codexx`, which is not an executor automata knows (valid values are `claude` and `codex`)
  Command      none; a real tick would post the working marker and then replace it with this refusal
```

`--dry-run --json` carries the same information as `executor`, `model`, `effort`, `executorSource`, `modelSource`, `effortSource` and `refusal` on each entry of `runs`; a real tick's `--json` carries the first six on each entry of `items`. `effortSource` is never `message` — no directive names a level — but it does change to the new executor's `config` when a `tool:` directive switches executor.

## Turn kinds

| Turn | When | What the model is told |
|---|---|---|
| `issue-discuss` | The issue has **no** linked open pull request | Do not touch the code — reply on the issue with specification, plan or questions. Unless a new message explicitly asks for implementation, in which case create a branch, implement, and open a pull request whose body contains `Closes #N`. |
| `pr-work` | The issue **has** a linked open pull request | Work on that pull request's head branch, which is already checked out. Address the new messages and unresolved review threads, commit and push, and reply on the pull request. Never merge it, never push to the base branch. |

The pull-request link is GitHub's own closing reference, so opening a pull request that closes the issue is what moves an issue from discussion into implementation. No intent classification and no extra model call is involved.

Because that link is the state machine, `do-work` repairs it after a discussion turn: if the branch now has a pull request without a closing reference to the issue, one is added. Repair applies **only** to a branch the turn moved onto. If the model merely replied, the tick is still on the base branch — where the "current branch's pull request" would be the base branch's own (a release pull request into `main`, say), and appending a closing reference to that would make an unrelated merge close the issue.

---

## Detection rules

**Work exists on a surface** when the newest message from an account in `allowedUsers` is strictly newer than the newest message from `agentUser` on that same surface.

- Messages from accounts that are neither authorized nor the agent are ignored entirely — they cannot trigger a turn and never appear in a prompt. This excludes bot reviewers such as Copilot and SonarCloud; use `automata execute-prompt sonar` / `fix-comments` for those.
- Logins are matched case-insensitively.
- A timestamp tie is **not** new, so the agent's own marker comment can never retrigger the turn that produced it.
- The issue body never acts as the boundary, so an issue opened by the agent is still processed.
- On a pull request, messages come from the conversation comments, non-empty review bodies, and unresolved review threads. A thread counts only when its **newest** comment is from an authorized human *and* the agent has not posted anywhere on the pull request since. Replying in the thread answers it; so does a conversation comment, because the prompt cannot guarantee the model is able to reply in-thread. Either way an unresolved thread the agent has answered does not retrigger, since resolving is the reviewer's action.
- A review comment's timestamp is taken from when its review was **submitted**, not when it was drafted. GitHub stamps a pending review's comments as they are written, so a reviewer working through a diff for twenty minutes produces comments dated before an answer the agent posted in the meantime — and using the draft time would mark that whole review answered and discard it.
- A merged or closed pull request is treated as no pull request, so the turn becomes a discussion.
- New messages on **both** the issue and its pull request produce exactly one build turn, with both sets of messages in the prompt.

The full decision table is in [wiki/Detection-Rules.md](wiki/Detection-Rules.md).

---

## The marker comment

Before each model run `do-work` posts a `working…` comment as the agent. It serves one purpose: it holds the answer boundary while the run is in flight, so a crashed run cannot cause the same message to be answered again on the next tick. If the marker cannot be posted, the item is skipped and the model is not invoked.

After the run, `do-work` re-reads the surface:

| The agent posted an answer | The marker |
|---|---|
| Yes | **Deleted.** The answer is newer and holds the boundary, so the marker is noise. |
| No | **Updated in place** to say the run finished or failed without posting an answer on that surface, to warn that the branch may still have changed, and to ask for a reply. |
| Cannot be determined | **Updated in place** to say the answer could not be verified. Asserting "no answer" would state something `do-work` has not established. |
| The run was refused before it started | **Updated in place** with the reason — an unrecognised `tool:` directive, or a prompt too long to hand to the executor. Nothing was invoked, so nothing changed. |

A third comment appears only when the timing was unlucky: if an authorized account posts while a run is already in flight, that message cannot reach the run, and because the agent's answer is newer the next tick will not see it as new either. A stateless boundary cannot carry it forward, so the agent says so and asks for it to be posted again. The same applies to an issue message buried by the pickup note. Either case reports the item as degraded (exit 2) rather than losing the message in silence.

The marker is deleted only after the answer is confirmed to exist, never on the strength of the executor's exit code — a run can exit non-zero having posted a good reply, and exit zero having posted nothing. Updating keeps the comment's creation time, so a run that produced nothing still holds the boundary and is **not** retried automatically; the updated text is what asks a human to step in.

The update deliberately does not claim that nothing changed: a run can commit and push and merely fail to comment, and a failed run can leave partial work behind. It points at the branch instead.

---

## Assignment

Before the first model run on an issue, `do-work` assigns the issue to `agentUser` so the claim is visible in the issue list. The assignment is additive — an issue already triaged to a human keeps that assignee — and is skipped when the agent is already assigned. It requires the agent account to have write access on the repository; if it fails, a warning is printed and the turn still runs, because assignment is signalling and does not affect correctness.

---

## The run lock

A tick is one or more full model sessions, and cron fires on a fixed interval, so overlap is normal. `do-work` holds `.automata/automata.lock` for the whole tick.

- Another **live** instance holds it → print a message and exit 0. Nothing is assigned, posted or invoked.
- The lock is **stale** → it is reclaimed. Stale means: the holder is on this host and its process is gone; or the holder is on another host and the lock is older than `doWork.lockStaleMinutes` (default 120); or the file is unparseable. On this host **liveness wins over age**: a long-running tick keeps its lock however old it is, because stealing it would put two model sessions in one checkout.
- Reclaiming a stale lock is exclusive: a contender must first win an atomic rename of the stale file out of the way, and only the winner may create the replacement. Renaming one's *own* candidate over the lock would not be enough — `rename` replaces unconditionally, so two contenders could each write and each read their own token back.
- Each acquisition records a unique token, and a holder releases only the lock it created — so a holder whose lock was reclaimed cannot evict its replacement on the way out.
- The lock is released on success, failure and interruption. On `SIGINT`/`SIGTERM` the executor is sent `SIGTERM`, escalated to `SIGKILL` if it does not exit, and **awaited** before the lock is released — escalating is not the same as having escalated successfully, since `SIGKILL` is asynchronous. If exit still cannot be confirmed the lock is deliberately **left in place**: handing it to the next tick while a model may still be running is the failure this exists to prevent.

The file is named for automata rather than for `do-work` so other long-running commands can adopt it later.

**Add `.automata/automata.lock` to your repository's ignore rules.** automata excludes the path from its own working-tree cleanliness check, so a tick will not skip its own items over it — but nothing makes `git status` ignore it for you, and an operator (or another tool) will otherwise see a stray untracked file. This repository ignores it in its own `.gitignore`; that does nothing for a repository where automata is installed.

---

## Exit codes

| Code | Meaning |
|---|---|
| `0` | The tick completed and every work item was answered. Also used for "nothing to do", "`--dry-run`", and "another instance is running". |
| `2` | Also used when the run lock is held by a process that looks alive but has outlived `doWork.lockStaleMinutes` and whose identity cannot be verified. No work is attempted, but exiting 0 there would hide a loop that has quietly stopped — see [the lock](#the-run-lock). |
| `1` | A precondition or configuration check failed. Nothing was attempted. |
| `2` | The tick ran, but at least one item ended in any outcome other than `answered`. |

Exit 2 means degraded, not broken. An item was:

- `skipped` — nothing was attempted: branch preparation failed, the marker could not be posted, the item stopped being actionable, or the pull request is unsafe to work on (from a fork, or its head *is* the base branch). A dirty tree reaches this path only when the [pre-flight rescue](#1-rescue-uncommitted-changes) itself failed;
- `failed` — the run errored, a read failed before the executor was reached, or the run was refused before it started (an unrecognised `tool:` directive, or an oversized prompt). A marker is updated only if one had already been posted;
- `deferred` — the run cap was reached. The cap counts model runs, so a skipped item does not consume one;
- `answered-no-reply` — the run finished without posting anything, or it answered but an authorized message arrived mid-run and had to be flagged. Either way a human must reply.

A degraded [pre-flight](#the-repository-hygiene-pre-flight) also produces exit 2 on its own — a rescue that could not push, a base branch that would not fast-forward, a branch whose state could not be read, or a branch that was pushed but got no draft pull request. Exit 1 is not used for it: by then the tick has run, so "nothing was attempted" would be false.

A healthy idle loop stays quiet at exit 0, which keeps cron mail meaningful.

---

## Running under cron

```cron
*/15 * * * * cd /workspace/my-repo && /usr/local/bin/automata do-work --silent >> /var/log/automata.log 2>&1
```

Pick an interval comfortably shorter than how long you are willing to wait for a reply, and do not worry about it being shorter than a tick — the lock handles that. See [wiki/Operations.md](wiki/Operations.md).

---

## What `do-work` never does

- Merge a pull request.
- Close an issue.
- Push to the base branch, or commit to it.
- Stash, reset, clean or otherwise discard uncommitted changes — the [pre-flight](#the-repository-hygiene-pre-flight) commits and pushes them instead, and if that fails the item is skipped.
- Delete a local branch whose work it cannot prove landed — it pushes the branch and opens a draft pull request instead. Proof is a merged pull request, or zero commits outside the base branch; a branch whose state it could not read is kept.
- Merge, rebase or reset the base branch to make a pull succeed.
- Act on a message from an account that is not in `allowedUsers`.
- Read a `tool:` or `model:` directive from anything but the newest message a turn is answering.
- Retry a failed run on its own.
