# Operations

Running the harness for real.

## The cron entry

```cron
*/15 * * * * cd /workspace/my-repo && /usr/local/bin/automata do-work --silent >> /var/log/automata.log 2>&1
```

Choose the interval from **how long you are willing to wait for a reply**, not from how long a tick takes. A tick that outlives its interval is expected and safe.

## The run lock

`do-work` holds `.automata/automata.lock` for the whole tick. A tick is one or more complete model sessions, so cron firing while one is still running is the normal case, not an exception — and two instances in one checkout would fight over the branch and push conflicting commits.

- **Another live instance holds it** → the second instance prints who holds it and exits **0** without touching GitHub. Not a failure; nothing is assigned, posted or invoked.
- **The lock is stale** → reclaimed. Stale means: the holder is on this host and its process is gone; or the holder is on another host and the lock is older than `doWork.lockStaleMinutes` (default 120); or the file is unparseable. On this host **liveness takes precedence over age** — a tick that legitimately runs for three hours keeps its lock, because stealing it would put two model sessions in one checkout.
- **The tick ends** — success, failure, or `SIGINT`/`SIGTERM` → the lock is released. On a signal the executor is stopped and awaited first, so an interrupted tick cannot orphan a model that keeps pushing.
- Each acquisition carries a unique token and releases only its own lock, so a superseded holder cannot evict its replacement.

The lock is taken *before* any state-changing GitHub call, so a contending instance cannot assign an issue or post a marker on its way out.

```console
$ automata do-work
Another automata instance is already running here (pid 4242 on runner-1,
started 2026-09-09T11:58:03.114Z, command do-work). Doing nothing.
```

## Exit codes

| Code | Meaning | What to do |
|---|---|---|
| `0` | The tick completed and every item was answered. Also "nothing to do", `--dry-run`, and "another instance is running". | Nothing. |
| `1` | A precondition failed; nothing was attempted. | Fix the configuration — the message names the command that sets the missing key. |
| `2` | The tick ran, but at least one item ended in an outcome other than `answered`. | Read the summary; see [Troubleshooting](Troubleshooting.md). |

Because a healthy idle loop stays at 0, cron mail stays meaningful: anything you hear about is worth looking at.

### The per-item outcomes behind exit 2

| Outcome | Meaning |
|---|---|
| `answered` | The model posted its answer. The marker was deleted. |
| `answered-no-reply` | The run finished but posted nothing. The marker was updated to say so; a human must reply. |
| `failed` | The run errored before posting an answer. The marker was updated with the error. |
| `skipped` | Nothing was attempted: dirty working tree, branch preparation failed, or the marker could not be posted. |
| `deferred` | The run cap was reached; the item waits for the next tick. |

`answered-no-reply` counts as degraded on purpose. A turn that produced nothing has stalled that issue until someone replies, and an unattended loop must surface that rather than report a healthy tick.

## Reading a tick

```console
$ automata do-work
Work plan (2 of 5 issues need an answer):
  #42 issue-discuss on develop — 1 new issue message, no open pull request, will assign to the agent
  #43 pr-work on feature/043-x — 2 unresolved review threads on pull request #58
  #44 nothing to do — nothing new since the agent's message at 2026-09-08T11:02:00Z
  ...

Tick summary:
  #42 issue-discuss answered — answered
  #43 pr-work answered-no-reply — run finished but posted no answer
```

The plan goes to stdout and the progress to stderr, so `--json` can be piped while you still watch the run.

## Capping the spend

`--max-runs <n>`, or `doWork.maxRunsPerTick`, bounds the model runs per tick. Items beyond the cap are reported as `deferred` and picked up next tick. Worth setting while you are still building trust: a label applied to twenty stale issues is otherwise twenty model runs.

## What the harness never does

Stated in one place, because trusting an unattended writer requires knowing its limits:

- **Never merges a pull request.** Landing is a human decision.
- **Never closes an issue.** GitHub closes it when the linked pull request merges.
- **Never pushes to the base branch.** Only to a pull request's own head branch.
- **Never stashes, resets or discards uncommitted changes.** A dirty working tree skips the item, with a warning.
- **Never acts on a message from an account outside `allowedUsers`.** Such messages cannot trigger a turn and never reach the model.
- **Never retries a failed run on its own.** The updated marker asks a human to reply instead; automatic retries would spend model calls forever on the same broken input.
- **Never answers the same message twice** — the marker holds the boundary even when a run crashes.

And one thing it *does* that you must plan for:

- **It runs the executor with permission prompts bypassed.** There is no option to change this: an unattended run cannot answer a prompt, so making it optional would only produce silent hangs. Run `do-work` in an isolated, disposable environment where an agent with full local permissions is acceptable.

## Turning it off

Remove the cron entry. There is no daemon and no in-flight state to unwind: the only persistent artefacts are ordinary GitHub comments, assignments and branches, plus a lock file that is reclaimed or deleted.

To pause without touching cron, remove the discovery label from the issues in flight — the next tick simply finds no candidates.
