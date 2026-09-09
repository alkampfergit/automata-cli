# Roadmap — what is deliberately not built

Each of these was considered and left out. The reasoning matters more than the list, because it explains where the harness's boundaries are.

## Azure DevOps

`do-work` is GitHub-only. It refuses an `azdo` remote with a pointer to [docs/azdo-gap.md](../azdo-gap.md).

The blocker is data, not design: work-item conversation retrieval is not available through `azdo-cli`, and the whole trigger depends on reading a conversation with authors and timestamps.

The detection core was built to be remote-agnostic in anticipation of this — the rules operate on a plain list of messages and know nothing about `gh` — so adding Azure DevOps means writing a second service that produces those messages, not a second state machine.

## Landing: merge and issue closure

The harness never merges a pull request and never closes an issue. Merging is the irreversible step, and it stays a human decision.

An auto-merge-on-green step is a plausible future feature, but it needs its own thinking about check requirements, approval rules and what happens to a failing merge — enough that bolting it onto `do-work` would compromise the part that works.

## Bot-reviewer turns

Copilot and SonarCloud comments do not trigger turns, because they are not in `allowedUsers`.

This is a real limitation with a real reason: bot reviewers post after every push, so a loop that answered them could keep pushing and being reviewed without ever settling. Making it safe needs a per-pull-request attempt cap and a definition of "done" that does not exist yet.

Meanwhile automata already has purpose-built commands for exactly this, and they are unaffected by `do-work`:

```bash
automata execute-prompt sonar --with claude
automata execute-prompt fix-comments --with claude
```

## Skills

automata models no concept of a skill, and this feature ships none. Skills are named by the prompts in `.automata/`, and the executors load whatever is installed in the environment. See [Prompts](Prompts.md).

That is not a gap to close — it is the extension point. Keeping automata ignorant of skills means behaviour changes are file edits rather than CLI releases, and means a fresh container with no plugins installed still behaves correctly rather than silently doing the wrong thing.

## A daemon

`do-work` is a single tick that exits. Scheduling is cron's job.

A long-running process would need its own supervision, restart policy, health endpoint and log rotation — all to replace one crontab line. The lock already solves the only problem a daemon would have solved.

## Cross-repository work

One tick works on the repository in the current directory. Multiple repositories mean multiple cron entries, which is simpler than any coordination the tool could offer, and keeps each repository's trust configuration its own.

## Parallel items within a tick

Items are processed one at a time. They share one working tree, so running two model sessions concurrently would mean two agents on one checkout — the exact failure the run lock exists to prevent between ticks. Real parallelism needs a worktree or container per item; the tick loop is where that would slot in if it is ever wanted.
