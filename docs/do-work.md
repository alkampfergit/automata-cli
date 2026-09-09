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
| `--issue <number>` | Process only this issue. Detection rules still apply; a warning is printed if the issue does not match the discovery filter. |
| `--limit <n>` | Maximum issues to fetch (default: `10`). A note is printed when the result was truncated. |
| `--max-runs <n>` | Maximum **model runs** this tick — an item skipped for a dirty tree, a failed marker, or because it stopped being actionable does not consume a slot. Remaining items are reported as `deferred`. Default: `doWork.maxRunsPerTick`. |
| `--dry-run` | Print the work plan, then a summary and the exact command that would be launched for each item, and stop. Nothing is assigned, posted, edited, deleted, checked out or invoked. |
| `--json` | Emit the plan and per-item outcomes as JSON on stdout; human-readable progress goes to stderr. |
| `--silent` | Suppress step-by-step Claude output. Affects printing only — the executor is always spawned the same way, so the command `--dry-run` shows is what runs. Ignored by Codex. |

Command-line options take precedence over the `doWork` configuration section, which takes precedence over the built-in defaults.

### Executor and model defaults

`do-work` always invokes the executor with **permission prompts bypassed** — an unattended run cannot answer a prompt, so there is no option to change this. It defaults to **Claude**, and Codex is selected with `--with codex` or `doWork.executor`.

Model defaults are held **per executor**, because a Claude model identifier is not a valid Codex model and vice versa:

```json
{ "doWork": { "executor": "claude", "models": { "claude": "claude-opus-4-6", "codex": "o3" } } }
```

Resolution for one run is: `--model` if given, else the default for the executor actually being used, else nothing (the executor picks its own). So `--with codex` on the configuration above sends `o3`, never the Claude identifier.

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
3. **Discover** candidate issues with one `gh issue list`, then resolve every open pull request's closing references with a paginated GraphQL query. Every page is read, and if the map cannot be read completely the tick **fails** rather than continuing: callers treat absence from it as proof that an issue has no pull request, so a partial map is a wrong answer, not a degraded one. Review threads are paginated for the same reason — feedback past thread 100 would otherwise be invisible to both detection and the prompt.
4. **Decide** a turn per issue (see below) and print the work plan. `--dry-run` stops here.
5. **Process** each work item sequentially:
   1. re-read the issue **and its pull-request link** and re-decide the turn. The plan was built before any model ran, and an earlier item can take a long time; a message arriving in the meantime has to be answered rather than buried behind the marker about to be posted, and a pull request opened in the meantime has to switch the turn to `pr-work` rather than starting a competing implementation. An item that stopped being actionable is skipped here, and the summary reports the turn that actually ran;
   2. check out the branch the turn needs (base branch for a discuss turn, the pull request's head branch for a build turn);
   3. assign the issue to the agent, if it is not already assigned;
   4. post a `working…` marker comment;
   5. invoke the executor;
   6. reconcile the marker — delete it if the agent posted an answer, update it in place to say what happened if it did not, and say the answer could not be verified if the surface could not be re-read;
   7. after a discuss turn only, and only if the turn actually moved off the base branch, make sure the new pull request closes the issue.
6. **Summarise** and exit.

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
- On a pull request, messages come from the conversation comments, non-empty review bodies, and unresolved review threads. A thread counts only when its **newest** comment is from an authorized human: if the agent replied last the thread is answered, even while it is still marked unresolved, because resolving is the reviewer's action.
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
| `1` | A precondition or configuration check failed. Nothing was attempted. |
| `2` | The tick ran, but at least one item ended in any outcome other than `answered`. |

Exit 2 means degraded, not broken: an item was `skipped` (dirty tree, branch or marker failure), `failed` (the run errored), `deferred` (run cap reached), or `answered-no-reply` (the run finished without posting anything, and a human must now reply).

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
- Push to the base branch.
- Stash, reset or discard uncommitted changes — a dirty working tree skips the item instead.
- Act on a message from an account that is not in `allowedUsers`.
- Retry a failed run on its own.
