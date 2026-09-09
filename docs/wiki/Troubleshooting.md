# Troubleshooting

## Nothing happens at all

| Check | How |
|---|---|
| Does the tick even see the issues? | `automata do-work --dry-run` — it prints a decision and a reason per candidate issue. |
| Is the discovery filter right? | The label must match `issueDiscoveryValue` exactly, and the issue must be open. |
| Is the commenter authorized? | Only accounts in `allowedUsers` can trigger a turn. A comment from anyone else is invisible. |
| Is `agentUser` the login the agent actually posts as? | `gh api user --jq .login` while authenticated as the agent. A mismatch makes the agent's own comments look like a third party's — so it never recognises its own answers and re-answers forever. |
| Did the tick start? | Exit 0 with "Another automata instance is already running" means the lock was held. See below. |

## "Another automata instance is already running", but nothing is

A stale lock whose process died in a way that could not be detected — usually because the lock was written on a different host (a container that has since been replaced), where liveness cannot be checked.

It expires after `doWork.lockStaleMinutes` (default 120). To clear it immediately:

```bash
cat .automata/automata.lock      # look at pid, host, startedAt
rm .automata/automata.lock       # only once you are sure no tick is running
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

For a GitHub App, use the full bot login including the `[bot]` suffix.

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
| `dirty-tree` | The working tree has uncommitted changes. `do-work` never discards work it did not create. | Commit or stash them yourself. In a disposable container, a dirty tree usually means a previous run left changes behind — investigate before clearing. |
| `checkout-failed` | The branch does not exist locally or remotely, or `git fetch` failed. | Check the branch still exists on the remote. |
| `pull-failed` | The local branch has diverged from the remote. The pull is `--ff-only`, so it fails loudly rather than merging silently. | Reconcile the branch by hand, or delete the local branch and let the next tick recreate it. |
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
