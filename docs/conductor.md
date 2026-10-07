# `automata conductor`

One tick of the conductor role, meant to be fired from cron like [`do-work`](do-work.md). It is part of the conductor
epic (#114). A tick does the pre-flight — configuration, identity and lock — prunes the [watch list](#watch-list), and
for each watched item whose newest message is the agent's runs a model [read-only](#running-the-model) that posts the
reply as a comment. Comment only: the conductor never approves or merges.

```bash
automata conductor              # one tick
automata conductor --check      # report what a tick would do; change nothing
automata conductor --dry-run    # write the replies, but do not post them
automata conductor add <id>     # watch an issue or pull request
automata conductor remove <id>  # stop watching it
automata conductor list         # show what is watched
```

The tick has no options.

## Watch list

The items the conductor follows are stored in `.automata/config.json` as `conductor.watch`, an array of issue and pull
request numbers (see [config.md](config.md)):

```json
{ "conductor": { "watch": [114, 120] } }
```

| Subcommand | Effect |
|------------|--------|
| `add <id>` | Resolves `<id>` as an issue or a pull request (`#114` is accepted too) and refuses a closed or merged one. Applies the discovery setting so [`do-work`](do-work.md) picks it up — the `issueDiscoveryValue` label for `label`, an assignment to the `issueDiscoveryValue` login for `assignee`; it exits 1 if that value is empty. Adding an issue also adds its open linked pull request(s) to the list; those get no label or assignee, because `do-work` reaches them through the issue. Adding an id already listed is not an error. |
| `remove <id>` | Takes the id off the list and changes nothing on GitHub — the label or assignee stays. Exits 1 if the id is not listed. |
| `list` | One line per watched item: kind, number, state and title. An item that cannot be read is shown as unavailable. |

`add` needs `issueDiscoveryTechnique` configured. `title-contains` cannot be applied to an existing item, so `add` fails
with it and stores nothing. The three subcommands do not need the conductor identity or the lock.

At the start of each tick, after the lock is taken, every closed issue and closed or merged pull request is dropped from
the list, and each removal is logged on stdout (`Conductor: dropped issue #114 from the watch list (closed).`). An item
that cannot be looked up (network or `gh` error) stays on the list, with a warning on stderr.

## Reply rule

The decision of whether a watched item needs a conductor reply is a pure function (`decideConductorReply`,
`src/conductor/replyDecision.ts`); the tick acts on it (see [Running the model](#running-the-model)). An issue and its linked pull request are decided
separately, and the item needs a reply when either does. A conversation needs a reply when the newest message from
`agentUser` has no later message from an allowed user (the roles of [`do-work`](do-work.md)'s rule, swapped):

| Outcome | When |
|---------|------|
| reply | `agentUser` wrote and no allowed user wrote after it. Review-thread comments count on a pull request, and an issue description written by `agentUser` counts as its message. |
| skip, `answered` | An allowed user wrote after the newest `agentUser` message. |
| skip, `no-agent-message` | `agentUser` never wrote there. |
| skip, `closed` | The issue is closed or the pull request closed or merged — the rule the tick-start prune uses. |
| skip, `limit` or `blocked` | A reply is owed, but the item reached its [reply limit](#loop-safety) or has the `conductor-blocked` label. |

Other accounts are ignored. Timestamps compare strictly, so an answer in the same second as the message does not count.

## The thread and its prompts

For a watched item the conductor builds one thread for the model (`composeConductorPrompt`,
`src/conductor/thread.ts`). The configured prompt comes first, verbatim, and the thread
follows it under `--- Thread assembled by automata ---`:

- For a watched **issue**: the issue and its conversation, then every linked pull request.
- For a watched **pull request**: that pull request only.
- Per pull request: state, branch and base, the conversation (comments and review bodies), the unresolved review
  threads with their file, line and URL, and the CI status — one line per check, with its conclusion, or its status
  while it still runs.

The pull request description is included when an allowed account wrote it.
Only messages from `allowedUsers` and `agentUser` appear, oldest first; other accounts are withheld, as in
[`do-work`](do-work.md). A resolved review thread is left out. No message is marked as new: the conductor reads the
whole thread.

The prompt depends on the kind of the watched item:

| Key | Used for |
|-----|----------|
| `conductor.prompts.issue` | A watched issue (and its linked pull requests) |
| `conductor.prompts.pr` | A watched pull request |

Each key holds prompt text or a plain `.md` filename in `.automata/`, resolved like `doWork.prompts`; see
[config.md](config.md#conductor). Without a key, a built-in default applies. Both defaults ask the model to write the
next message to the agent, and forbid file changes, merging, closing and pushing.

After the thread, automata appends the posting instruction itself, so a configured prompt cannot lose it: post one
comment with `gh issue comment <n> --body-file -` (or `gh pr comment <n> --body-file -`), the body on standard input,
because what the model prints is discarded.

## Running the model

For each item left on the watch list, the tick reads the thread and applies the reply rule. When a conversation needs a
reply, it runs the model once for the first such conversation (the issue, then its pull requests); the others are
handled on a later tick, once this one is answered. A tick logs `Conductor: #7 needs no reply.` for the rest.

| Setting | Meaning |
|---------|---------|
| `conductor.executor` | `claude` (default). `codex` is refused. |
| `conductor.models.<executor>` | Model passed to that executor |
| `conductor.effort.<executor>` | Reasoning effort passed to that executor, unchanged |

They are keyed per executor like `doWork.models`; see [config.md](config.md#conductor). An unusable value exits 1 before
the lock is taken.

The run is **read-only**:

- Claude runs with `--permission-mode dontAsk`, may only read and search inside the working directory, look at a thread with `gh issue view`,
  `gh pr view`, `gh pr diff` and `gh pr checks`, use `git status`, and post with
  `gh issue comment <n> --body-file -` or `gh pr comment <n> --body-file -` for the one reply target only. Comments on
  any other number are denied. `git log`, `git diff` and `git show` are not allowed, because `--output` lets them write
  a file. `Edit`, `Write` and `NotebookEdit` are denied. The run sets `GH_REPO` to the watched repository, and `gh`
  calls with `--repo` or `-R` are denied, so `gh` cannot reach another repository.
- Codex is not supported. It has no command allow-list, so it cannot be limited to comments on the reply target.
  With `conductor.executor` set to `codex` the tick writes an error and exits 1 before the lock is taken.

After the run the tick reads the conversation again. A reply counts as posted only when the account `gh` runs as has a
comment that was not there before. Otherwise the tick writes an error on stderr and exits 1:

| Message | Meaning |
|---------|---------|
| `finished but posted no comment on <surface>` | The run succeeded and posted nothing; its output is discarded, so nothing is recovered. |
| `failed and posted no comment on <surface>` | The run failed and nothing was posted. |
| `could not tell whether … got a reply` | The conversation could not be read before or after the run. |

A run that fails after it posted counts as posted, with a warning. An item that cannot be read is skipped with a warning
and does not change the exit code. Nothing stops a later tick from running again on an item whose run posted nothing,
except the [loop-safety rules](#loop-safety), which cap the replies.

## Loop safety

Two unattended agents can answer each other for ever, so a tick stops on its own. The rules apply to the watched item
as a whole (an issue and its linked pull requests together) and turn an owed reply into a skip:

| Rule | Skip reason | Effect |
|------|-------------|--------|
| Reply limit | `limit` | The conductor has posted `conductor.maxRepliesPerItem` replies (default 5) on the item. Raise the setting to resume. |
| Blocked | `blocked` | The watched item has the `conductor-blocked` label. Remove the label to resume. |
| Closed | `closed` | A closed issue, or a closed or merged pull request, is left alone. |

**Counting.** The count comes from the conversation, so a fresh checkout counts the same as an old one. The posting
instruction tells the model to end each reply with the line `<!-- automata:conductor -->`; the count is the number of
comments, on the issue or its pull requests, that carry it. A reply that lacks the marker is not counted.

**Needs a human.** When the model cannot go on without a person, it posts no comment and ends its final message with
`NEEDS-HUMAN: <reason>`. The tick then adds the `conductor-blocked` label to the watched item (the issue, or the watched
pull request) and stays silent on the conversation. If the repository has no such label, the tick creates it. The
model has no permission to edit labels; automata applies the label. If the label cannot be applied, the tick writes an
error and exits 1. A model run that posted a reply and also printed `NEEDS-HUMAN:` is labelled too.

**Overlapping entries.** `watch add` on an issue also follows its linked pull requests, and the issue's conversation
already includes them. A tick, `--check` and `--dry-run` give such a pull request no separate reply while its issue
stays on the watch list, so the limit and the label of the issue cannot be bypassed.

**Several checkouts.** The run lock is local to one checkout. The limit is checked before the model runs, so two
checkouts that run at the same time can both post and pass the limit by a small amount. The next tick on any checkout
counts the replies on GitHub and stops. Run the conductor from one checkout for each repository when the limit must be exact.

A tick logs why it left an item alone, for example `Conductor: #7 gets no reply: the item has the conductor-blocked
label; remove it to resume.` `--check` shows the same skip reasons, and `--dry-run` obeys both rules. A `--dry-run`
answer of `NEEDS-HUMAN:` is printed and applies no label.

## `--check` and `--dry-run`

Both options leave the repository, the watch list and GitHub unchanged. Use only one of them: `--check --dry-run` is a
usage error (exit 1). The pattern is that of [`do-work --check`](do-work.md).

### `--check`

A read-only report of what a tick would do now. It does not take the lock, prune, comment or start a model. It has
four sections, a `Problems` list when there are findings, and a `RESULT` line:

| Section | Content |
|---------|---------|
| Configuration | The `gh` account and the executor with its model and effort. An unusable configuration or identity is the only content shown; it is a problem. |
| Run lock | `free`, `held` (a conductor is running; a tick would do nothing), `stale` (the next tick takes it over), `suspect` or `unreadable`. |
| Watch list | One line per watched id. A closed issue or a closed or merged pull request is marked as one a tick would drop (a pending prune). An id that cannot be read is marked unavailable. |
| Replies a tick would write | For each open item, the [reply rule](#reply-rule) decision per conversation: `reply on …` or `skip … (<reason>)`. |

Problems, and exit code 1: an unusable configuration or identity, a `suspect` or `unreadable` lock, and a watched id that
cannot be read. A live lock, a pending prune and an owed reply are information, not problems. The check reads GitHub
through `gh` only, so it needs no `--no-fetch`.

```text
automata conductor --check — acme/widget — 2026-10-05T13:00:00.000Z

Configuration
  running as alice
  executor: claude · model opus

Run lock
  no conductor is running in this checkout

Watch list (2)
  issue #5: open
  PR #7: closed, a tick would drop it from the watch list

Replies a tick would write
  reply on issue #5: bot's message at 2026-10-01T00:00:00Z has no answer from an allowed user

RESULT: healthy
```

### `--dry-run`

A tick that runs the model for the reply a tick would post for each watched item (the first owed conversation of the
item; `--check` lists all of them) and prints the reply instead of posting it:

```text
--- Dry run: reply for issue #5 (not posted) ---
<the reply text>
---
```

- The run has no permission to comment. The prompt tells the model that this is a dry run and that its final message is
  the reply; that message is what is printed.
- A watched issue and its linked pull request can both be on the watch list. A real tick posts its reply, so the
  next item sees it and does not answer the same conversation again. A dry run posts nothing, so it remembers each
  conversation it has already answered and prints one reply for it only.
- The watch list is not changed. A closed item is reported as one a tick would drop, and is not read further.
- The lock is not taken, because nothing is written. If a conductor holds the lock, a warning goes to stderr and the dry
  run continues.
- The identity check and the configuration check apply as for a tick.
- The `codex` executor is refused (exit 1), as for a tick: it has no command allow-list, so it cannot be limited.
- The [loop-safety rules](#loop-safety) apply. A reply of `NEEDS-HUMAN: <reason>` is printed as such; no label is applied.
- The exit code is 1 when a model run fails or prints no reply text, otherwise 0.

## Configuration

It reads the same `.automata/config.json` as `do-work`, but needs only `allowedUsers` and `agentUser` (see
[config.md](config.md)). `conductor.maxRepliesPerItem` sets the [reply limit](#loop-safety). An explicit `remoteType: "azdo"` is rejected, as for `do-work`.

## Identity

The conductor is a human instructing the agent, so the account `gh` is authenticated as must be

- listed in `allowedUsers` (case-insensitive), and
- different from `agentUser`.

Otherwise the command prints the reason on stderr and exits 1. An unverifiable identity (`gh` unauthenticated, or an
app installation token with no user) also exits 1: unlike `do-work`, which acts *as* the agent, the conductor has to
prove it is an allowed account.

## Run lock

The conductor takes its own lock, `.automata/conductor.lock`, so it runs next to `do-work` (which uses
`.automata/automata.lock`); only a second conductor is turned away. The lock is stale after `doWork.lockStaleMinutes`.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Tick completed, or another conductor holds the lock (nothing done) |
| 1 | Configuration unusable, the identity check failed, or a model run failed or posted no reply |
| 2 | The conductor lock looks alive but outlived the stale window — probably a reused pid; the message names the file to remove |
