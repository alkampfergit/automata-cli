# `automata conductor`

One tick of the conductor role, meant to be fired from cron like [`do-work`](do-work.md). It is part of the conductor
epic (#114). A tick does the pre-flight — configuration, identity and lock — prunes the [watch list](#watch-list), and
for each watched item whose newest message is the agent's runs a model [read-only](#running-the-model) that posts the
reply as a comment. Comment only: the conductor never approves or merges.

```bash
automata conductor              # one tick
automata conductor --check      # report what a tick would do; change nothing
automata conductor --dry-run    # write the replies, but do not post them
automata conductor --verbose    # trace the work behind a tick or a run of the options above
automata conductor --automatic  # run a tick every 60 seconds until nothing open is watched
automata conductor --automatic --interval 30
automata conductor add <id>     # watch an issue or pull request; a parent with children becomes a story
automata conductor remove <id>  # stop watching it
automata conductor list         # show what is watched
```

| Option | Effect |
|--------|--------|
| `--check` | Report what a tick would do; change nothing. |
| `--dry-run` | Write the replies, but do not post them. |
| `--automatic` | Run the tick in a loop; see [Automatic mode](#automatic-mode). |
| `--interval <seconds>` | Seconds between two ticks. A positive whole number, default 60. Needs `--automatic`. |

## Automatic mode

`--automatic` replaces an external cron. The command stays in the foreground and prints the output of every tick in
the terminal, so that terminal cannot take other commands. Each iteration is a whole tick: it takes the conductor lock,
prunes the watch list, conducts each item and releases the lock. Then the command waits `--interval` seconds.

- A tick that exits 1, or that finds the lock held, does not stop the loop. The next tick runs after the interval.
- The loop exits with code 0 when the watch list is empty after the prune, also when it is empty at the start. A
  watched item that cannot be read stays on the list, so a network error does not end the loop.
- Ctrl+C (SIGINT) or SIGTERM stops the loop after the current tick has released its lock. A second signal exits at once.
- `--automatic` cannot be used with `--check` or `--dry-run`. `--interval` without `--automatic` is an error. Both
  errors exit 1 before any tick.

## Copilot review threads

A pull request (a watched one, or the one linked to a watched issue) with an unresolved review thread that Copilot
started is owed a reply, also when the agent did not speak last. The prompt then gets a block that lists each thread
(file, line, URL and Copilot's comment) and tells the model to write, in its reply, an instruction to the agent: fix
each comment, and then resolve the review thread. The conductor run stays read-only; it does not resolve threads.

- A Copilot account is a login that contains `copilot`, for example `Copilot`.
- The turn is owed only when Copilot wrote after the newest conductor reply (the reply marker) on that conversation.
  Open threads therefore do not draw a new reply on every tick.
- While the `do-work` run lock is held the agent is working, and the conductor starts no Copilot turn; it logs this and
  tries again on the next tick.
- [Loop safety](#loop-safety) applies: the reply limit and the `conductor-blocked` label stop a Copilot turn too.

## Rebase check

Some checks run on every watched item, even one with the `conductor-blocked` label or one that has used its replies.
Today there are two: the rebase check and the [CI-fix check](#ci-fix-check), in that order (`src/conductor/alwaysChecks.ts`; another check is one more function in
`ALWAYS_CHECKS`). It runs before the [loop-safety rules](#loop-safety).

A watched pull request, or an open pull request linked to a watched issue, is owed a rebase request when GitHub reports
`mergeable: CONFLICTING`. `MERGEABLE` and `UNKNOWN` do nothing; GitHub computes the value lazily, and the next tick
reads `UNKNOWN` again. A pull request that is not watched is not touched.

The turn is an ordinary conductor turn on that pull request, with `conductor.prompts.rebase` as its instructions. The
model posts that request as a comment to the agent; the agent does the rebase. The comment ends with the marker
`<!-- automata:conductor-rebase head=<sha> -->` instead of the reply marker. Only a comment of an allowed user (`allowedUsers`, the accounts the conductor posts as) counts, and only when the marker is the last line of the comment; a marker from another account is ignored. A rebase request on a linked pull request runs before an ordinary reply on the issue. The marker gives two rules:

| Rule | Skip reason | Effect |
|------|-------------|--------|
| Once per head commit | `rebase-done` | A rebase request for the current head commit exists, so the check waits. A new push gives a new commit and arms the check again. |
| Rebase limit | `rebase-limit` | The item has `conductor.maxRepliesPerItem` rebase requests (default 5). The rebase requests have their own counter: they do not use up the replies, and the replies do not use up the rebase requests. |

If the rebase run ends with a `NEEDS-HUMAN:` line, the item gets the `conductor-blocked` label again and the
conductor posts one short note with the rebase marker, so the check does not run again for the same head commit. As for
a Copilot turn, the check waits while the `do-work` run lock is held. `--dry-run` prints the request and `--check` lists
it as `rebase request on PR #<n>`.

## CI-fix check

The second always check asks the agent to fix a build that failed. It has the same shape as the rebase check, and it
also runs on an item with the `conductor-blocked` label.

A watched pull request, or an open pull request linked to a watched issue, is owed a CI-fix request when at least one
check has finished with the conclusion `FAILURE`, `TIMED_OUT`, `ACTION_REQUIRED` or `CANCELLED`. The check waits while
any check is still pending. It does nothing when GitHub reports `mergeable: CONFLICTING`, because the rebase check comes
first; a push after the rebase re-arms it. Set `conductor.ciFix.enabled` to `false` to switch it off.

The turn is an ordinary conductor turn on that pull request, with `conductor.prompts.ciFix` as its instructions. The
model finds the failed checks, posts the request as a comment to the agent, and the agent fixes the build and pushes.
The comment ends with the marker `<!-- automata:conductor-ci-fix head=<sha> -->`. Only a comment of an allowed user
(`allowedUsers`) counts, and only when the marker is the last line of the comment. The marker gives two rules:

| Rule | Skip reason | Effect |
|------|-------------|--------|
| Once per head commit | `ci-fix-done` | A CI-fix request for the current head commit exists, so the check waits. A new push gives a new commit and arms the check again. |
| CI-fix limit | `ci-fix-limit` | The item has `conductor.maxRepliesPerItem` CI-fix requests (default 5). They have their own counter, apart from the replies and the rebase requests. |

If the run ends with a `NEEDS-HUMAN:` line, the item gets the `conductor-blocked` label again and the conductor posts
one short note with the CI-fix marker, so the check does not run again for the same head commit. As for the rebase
check, it waits while the `do-work` run lock is held. `--dry-run` prints the request and `--check` lists it as
`CI-fix request on PR #<n>`.

## Watch list

The items the conductor follows are stored in `.automata/conductor-watch.json`, an array of issue and pull request
numbers:

```json
{ "watch": [114, 120] }
```

The file is machine state, not configuration. It is in `.gitignore`, so `add`, `remove` and the pruning of a tick do
not change `git status`, and they never write `.automata/config.json`.

**Add `.automata/conductor-watch.json` to your repository's ignore rules.** This repository ignores it in its own
`.gitignore`, but that does nothing for a repository where automata is installed. `AUTOMATA_OWN_PATHS` only keeps
automata's own cleanliness checks from counting the file. Without the ignore rule, `add` or the migration leaves an
untracked file in `git status`. A missing file, or a file that cannot be read
or parsed, is an empty list. Entries that are not positive integers are ignored.

**Migration.** Older versions kept the list in `.automata/config.json` as `conductor.watch`. When
`.automata/conductor-watch.json` does not exist and `conductor.watch` has entries, the first command that can write the
list copies them into the new file. `config.json` is not changed. After that the old key is ignored; you can delete it. `--check` and `--dry-run` read the old entries but never create the file.

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

## Stories

A story is a parent issue whose child issues the conductor starts one at a time, in order. `conductor add <parent>`
reads the children of the parent: its native sub-issues, or, when it has none, the issues named in the task list of its
body (`- [ ] #12` or `- [x] #12`, or a link to an issue of this repository). Sub-issues of another repository are
ignored. An issue with no children is watched as an ordinary issue, as before.

A story is stored in the same file as the watch list, under `stories`; the file shows the key only when a story exists.
The children are never stored: a tick reads them again, so a change made in GitHub counts at once.

```json
{ "watch": [114], "stories": [153] }
```

The parent gets no label and no reply from the conductor. Only the children are implemented, by [`do-work`](do-work.md).
At each tick the conductor finds the first open child and acts on it. It never skips a child.

| Child state | Meaning | Tick |
|-------------|---------|------|
| `closed` | Done: the child is closed and has no open pull request. | Passed over. |
| `next` | First open child, with no open pull request and no discovery setting. | Applies the discovery setting (label or assignee) so `do-work` implements it. |
| `started` | First open child that has the discovery setting and no pull request. | Waits. |
| `in review` | First child that has an open pull request, also a closed child. | Waits until the pull request is merged and the child is closed. |
| `blocked` | First open child with the `conductor-blocked` label. | Does nothing on GitHub, until a person removes the label. |
| `queued` | A later open child. | Waits for its turn. |

When all children are closed, the conductor closes the parent with one comment that names the children, and drops it
from the stories. A closed parent is dropped at the start of its turn, with a line on stdout. A story that cannot be read
stays, with a warning, as an item does. `--automatic` counts a story as an open item. A tick runs no model for the parent.
When a tick starts a child, the conductor also posts one comment on it, so `do-work` sees a message from an authorized
account. The child that the story waits for, and its linked pull requests, get the ordinary conductor processing: a reply
to an agent question, a rebase request or a CI-fix request. A closed parent is dropped without a read of its children.
`conductor add` on a watched parent that has children removes its ordinary watch entry.

`conductor list` shows each story with its children and their states. `conductor --check` adds a `Stories` section: for
each story, which child is next, which is waiting and which is blocked; an unreadable story is a problem. `--dry-run`
prints what a tick would do and changes nothing. `conductor remove <parent>` takes a story off the list and changes
nothing on GitHub. `add` needs the same discovery setting as for an item; `title-contains` is refused.

## Reply rule

The decision of whether a watched item needs a conductor reply is a pure function (`decideConductorReply`,
`src/conductor/replyDecision.ts`); the tick acts on it (see [Running the model](#running-the-model)). An issue and its linked pull request are decided
separately, and the item needs a reply when either does. A conversation needs a reply when the newest message from
`agentUser` has no later message from an allowed user (the roles of [`do-work`](do-work.md)'s rule, swapped):

| Outcome | When |
|---------|------|
| reply | `agentUser` wrote and no allowed user wrote after it. Review-thread comments count on a pull request, and an issue description written by `agentUser` counts as its message. |
| reply (Copilot) | A pull request has an unresolved Copilot review thread newer than the newest conductor reply; see [Copilot review threads](#copilot-review-threads). |
| skip, `answered` | An allowed user wrote after the newest `agentUser` message. |
| skip, `agent-working` | The newest `agentUser` comment is the `automata do-work: working…` marker, newer than the newest real `agentUser` message, and no allowed user wrote after it. A `do-work` run is in flight, so the conductor does not reply. The marker is never the message that waits for an answer, in the conversation or in a review thread. A marker left by a crashed run keeps the item quiet in the same way until an allowed user writes again or the next `do-work` tick answers it. There is no timeout, because a conductor reply there would loop. |
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
| `conductor.prompts.rebase` | A [rebase request](#rebase-check) for a watched pull request that has a merge conflict |
| `conductor.prompts.ciFix` | A [CI-fix request](#ci-fix-check) for a watched pull request that has a failed check |

Each key holds prompt text or a plain `.md` filename in `.automata/`, resolved like `doWork.prompts`; see
[config.md](config.md#conductor). Without a key, a built-in default applies. The issue and pull request defaults ask the model to write the
next message to the agent, and forbid file changes, merging, closing and pushing. The rebase default is the request itself: fetch, update the target branch, rebase, resolve conflicts, commit and push, wait for the checks, and fix a failing check or a SonarCloud issue. The CI-fix default is, like the issue and pull request defaults, an instruction for the model: find the failed checks with `gh`, name each one with its error, and tell the agent to reproduce the failure, fix the cause, push, wait for the checks and end with `NEEDS-HUMAN:` if it cannot fix the failure.

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
  `gh pr view`, `gh pr diff`, `gh pr checks` and `gh run view` (for the failed-check logs), use `git status`, and post with
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

## `--verbose`

Add `--verbose` to a tick, to `--check` or to `--dry-run` to see the work behind the result. It writes to stderr, so
stdout is the same as without it. It changes no behaviour.

- `Commands (N)` lists every `git` and `gh` call that automata made, with its duration and exit code. It is printed
  after the tick, in the format of [`do-work --verbose`](do-work.md).
- The steps of the model run are printed as they happen (`[step N] running: …`).
- After each model run, the tool calls that the permission mode refused are listed, for example
  `Bash gh issue comment 94 --body "…"`. The model's own summary does not give this. A run that did not
  report a refusal prints `the run for #94 reported no denied tool call`.

Use it when a tick says `needs a human (… denied by permissions)`: the denied command shows which call is outside the
allow-list described in [Running the model](#running-the-model).

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
