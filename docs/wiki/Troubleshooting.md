# Troubleshooting

## Nothing happens at all

| Check | How |
|---|---|
| Does the tick even see the issues? | `automata do-work --dry-run` — it prints a decision and a reason per candidate issue. |
| Is the discovery filter right? | The label must match `issueDiscoveryValue` exactly, and the issue must be open. |
| Is the commenter authorized? | Only accounts in `allowedUsers` can trigger a turn. A comment from anyone else is invisible. |
| Is `agentUser` the login the agent actually posts as? | `gh api user --jq .login` while authenticated as the agent. A mismatch makes the agent's own comments look like a third party's — so it never recognises its own answers and re-answers forever. |
| Did the tick start? | Exit 0 with "Another automata instance is already running" means the lock was held. See below. |
| Did the tick say why it did nothing? | It does now: a blocked tick prints the whole six-section health report on stderr, headed by what blocked it. See [do-work.md](../do-work.md#when-a-tick-does-nothing). |

## "Another automata instance is already running", but nothing is

A stale lock whose process died in a way that could not be detected — usually because the lock was written on a different host (a container that has since been replaced), where liveness cannot be checked.

It expires after `doWork.lockStaleMinutes` (default 120). Ask `--check` first — it names the holder, the directory
it runs from, and what phase it is in:

```bash
automata do-work --check
```

A `phase:` line whose "updated" age keeps growing is a tick that really is working; one frozen minutes ago is not.
A `logs to … (this check reads …)` line means the holder runs from a different checkout than the one you are asking
about, and the two are writing different operation logs.

To clear the lock by hand:

```bash
cat .automata/automata.lock      # look at pid, host, startedAt, cwd
rm .automata/automata.lock       # only once you are sure no tick is running
rm -f .automata/automata-heartbeat.json
```

Lower `doWork.lockStaleMinutes` if your ticks are always short.

## The same message is answered twice

The marker mechanism failed. Look for:

- **A marker that could not be posted** — the item should have been *skipped*, so check the tick output for `marker failed`. If the agent account cannot comment, fix its permissions.
- **A marker deleted without an answer** — should be impossible (deletion is guarded by re-reading the surface), but a mismatched `agentUser` produces the same symptom: the agent does not recognise its own answer, so the boundary never advances.

## The agent answers its own messages

`agentUser` does not match the login the agent posts as. Fix it:

```bash
automata config set agent-user "$(gh api user --jq .login)"   # run as the agent account
```

For a GitHub App the right value is whatever `gh` actually reports as the comment
author, which is not necessarily the login you see in the web UI — GraphQL and
REST differ on the `[bot]` suffix. Read it off a real comment rather than
guessing:

```bash
gh issue view <n> --json comments --jq '.comments[].author.login'
```

Use exactly the string that appears there for a comment the agent posted.

## An issue stays in discussion after a go-ahead

The turn kind is decided by whether an **open pull request declares a closing reference** to the issue. If the model opened a pull request without `Closes #N`, the link does not exist.

`do-work` repairs this after every discussion turn — it checks the current branch for a pull request and adds the closing reference if missing. If it is still not linked, check the tick's stderr for `could not link a pull request` (usually a permissions failure), and confirm with:

```bash
gh pr view <n> --json body --jq .body    # must contain "Closes #<issue>"
```

You can also link them by hand in the GitHub UI — `closingIssuesReferences` covers that too.

## Items are skipped

| Message | Cause | Fix |
|---|---|---|
| `dirty-tree` | The working tree has uncommitted changes and nothing rescued them. Either the pre-flight rescue failed, or an executor earlier in the *same* tick left changes behind — the pre-flight runs once, before the first item, so it cannot clean up after one. `do-work` never discards work it did not create. | If there is a `Pre-flight:` block, read it for the step that failed (usually a rejected push or an unauthenticated `gh`). If it reported `clean`, an earlier item in the same tick is the source — see which one ran before this. Either way the changes are untouched, so commit and push them yourself. |
| `checkout-failed` | The branch does not exist locally or remotely, or `git fetch` failed. | Check the branch still exists on the remote. |
| `pull-failed` | A branch could not be brought up to its remote. Which branch depends on the turn: `issue-discuss` prepares the **base** branch, `pr-work` and `pr-orphan` the pull request's **head** branch. The detail names the case — read it before acting. | See the three rows below; they split this reason by what the detail says. |
| `pull-failed` on the base branch (`Not possible to fast-forward`) | The local base branch holds a commit `origin` does not. `do-work` never merges, rebases or resets a base branch — each would be a judgement about somebody's commit. | Do not reset blindly: the commits may be wanted. Follow [Recovering a base branch that will not fast-forward](../do-work.md#recovering-a-base-branch-that-will-not-fast-forward), which shows how to move them onto a branch of their own first. |
| `pull-failed` on a head branch (`… and N of its commits are not on origin/<branch>`) | The local branch has diverged from the remote **and** holds a commit that is not on the remote in any form. `do-work` recovers from a divergence by itself in two cases — a force push (every local commit already reachable from the remote-tracking ref before the fetch, the Dependabot rebase case) and an *equivalent* divergence (every local commit already on the remote as the same patch, under a different sha). Neither applied here, so nothing was moved. | The skip message names how many commits are unpushed. Inspect them with `git log origin/<branch>..<branch>`, then `git reset --hard origin/<branch>` once they are safe to lose, or delete the local branch and let the next tick recreate it. |
| `pull-failed` on a head branch (`no commit of the local <branch> is missing from origin/<branch>`) | The fast-forward failed, but the local branch holds nothing the remote does not — so this is not a divergence at all and no recovery applies. Typically a stale `index.lock`, a ref this process cannot write, or a hook that rejected the pull. The branch is untouched. | Fix git's own error, quoted at the front of the detail. Do **not** `git reset --hard`: there is nothing to reconcile, and the next tick pulls the branch by itself once the cause is gone. |
| `pull-failed` on a head branch (`a rebase is already in progress … automata did not start it`) | A rebase was halted in the checkout before the item came up, with a tree clean enough to get past the cleanliness gate — a paused manual rebase, an `--exec` that failed, a session that stopped. `do-work` refuses rather than aborting work it did not start. The branch and the halted rebase are both untouched. | Finish it with `git rebase --continue` or drop it with `git rebase --abort`, then let the next tick run. An interrupted `git am` is *not* reported here and is never touched; `git status` names whichever one is in progress. |
| `pull-failed` on a head branch (`did not land on the remote tip`) | The rebase reported success but the branch is still not the remote tip, so a commit was replayed instead of dropped. The branch is left where the rebase put it, and the item is refused rather than logged as synchronized. | Compare the two with `git log origin/<branch>..<branch>`. Check whether the repository sets `rebase.reapplyCherryPicks` or a rebase hook that rewrites commits; `git reset --hard origin/<branch>` resolves it when what is left is disposable. |
| `pull-failed` on a head branch (`could not be established`) | `git cherry` itself failed, so how the local branch relates to the remote was never determined — a broken ref, an unreadable object, output that could not be parsed. No recovery ran and the branch is untouched. Nothing is claimed about a divergence, because nothing was read. | Start from git's own error, quoted at the front of the detail. `git log --oneline origin/<branch>...<branch>` and `git fsck` show what state the checkout is in. Do **not** reset until it is clear what is there. |
| `pull-failed` with any other detail | The branch qualified for a recovery that then failed on its own terms — a `git reset --hard` that could not write the ref, or a rebase that git refused before replaying anything (`the rebase never started`, typically a pre-rebase hook or a locked ref). The branch is untouched either way. | The detail carries git's own error; fix that cause. A stale `index.lock` or `refs/heads/<branch>.lock` left by a killed process is the usual one — remove it and the next tick recovers the branch by itself. |
| `rebase-conflict` | The branch qualified for the automatic rebase, but replaying it conflicted. The rebase was aborted, so the branch is back on the tip it started from. | Read the conflict in the skip message. Usually the remote has moved further than the equivalence suggested; `git fetch && git log origin/<branch>..<branch>` shows what is left, and a manual `git reset --hard origin/<branch>` resolves it when the local commits are disposable. If the message says the abort itself failed, run `git rebase --abort` in the checkout before the next tick — a rebase in progress reads as a dirty tree and refuses every item. |
| `marker failed` | The `working…` comment could not be posted, so no model was invoked. | Usually the agent account cannot comment on the repository. |

## A "working…" comment is stuck on an issue

Either a tick is running right now, or a run produced no answer and the marker was updated to explain it. Read the comment:

- *"the agent run finished without posting an answer here"* → the model ran but posted nothing. Often a prompt that does not tell the model where to reply. Reply on the issue to trigger another attempt.
- *"the agent run failed before posting an answer (…)"* → the executor errored; the message includes the error.

Note the marker is **not** retried automatically — that is deliberate, so a broken input cannot burn model calls indefinitely. Your reply is what starts the next attempt.

If a marker is left from a killed process and says only `working…`, it is safe to delete by hand — but then the message it was covering becomes unanswered again, and the next tick will answer it.

## A run reported `answered-no-reply`

The model did its work but never posted a comment. Almost always the prompt: check that your frame tells the model **where** to reply (the issue for a discussion turn, the pull request for a build turn) and instructs it to always post a reply. See [Prompts](Prompts.md).

## Bot review comments are ignored

By design — Copilot and SonarCloud are not in `allowedUsers`, and they comment after every push, so a loop that answered them would never settle. Use the purpose-built commands:

```bash
automata execute-prompt sonar --with claude
automata execute-prompt fix-comments --with claude
```

## "`gh` is authenticated as X, which is listed in allowedUsers"

`do-work` refused to start, and it was right to. Comments are attributed to
whoever `gh` is authenticated as, so running as an authorized account means the
agent's own `working…` marker looks like a new instruction from a human — and
every tick would answer the marker the previous tick left behind.

Authenticate `gh` as the agent account in this environment:

```bash
gh auth login                       # as the agent account
gh api user --jq .login             # must equal agentUser
```

`--dry-run` is exempt: it posts nothing, so you can always inspect the plan from
your own workstation without switching accounts.

If you meant to run as yourself for a one-off task, use `automata implement-next`
or `automata execute-prompt` instead — they have no boundary to protect.

## "`gh` is authenticated as X but agentUser is Y"

Also a refusal, for the same underlying reason: the agent would post as an
account that is neither itself nor an authorized user, so the conversation filter
drops those comments entirely. The boundary would never advance and the same
message would start a run on every tick.

Either authenticate as `agentUser`, or set `agentUser` to the account you are
actually posting as.

The only accepted mismatch is an *unverifiable* one — a GitHub App installation
token has no user login, and that is a legitimate setup. There you will see
"could not determine which account `gh` is authenticated as" and the tick
proceeds.

## `do-work` exits 1 immediately

A precondition failed and nothing was attempted. The message names what to fix. The one that surprises people:

```
Error: Prompt file "do-work-issue-discuss.md" not found in
"/workspace/my-repo/.automata". Expected path: …
```

A configured `doWork` prompt that cannot be resolved **fails the tick** rather than falling back to the built-in default — silently running different instructions than the ones you configured would be worse. Create the file, or unset the key.

## The tick is slow

Model runs dominate; API calls do not. A tick with nothing to do makes two API calls plus one per candidate issue, and no model calls. If ticks are long, it is because items are being worked — cap them with `--max-runs` or `doWork.maxRunsPerTick`.

## Everything looks right but the model does the wrong thing

The context automata assembles is fixed and guaranteed; the instructions are entirely yours. Print what the model actually receives by reading your frame plus the context described in [Prompts](Prompts.md), and check that the turn boundary is stated — particularly that a discussion turn forbids code changes *except* on an explicit go-ahead.
