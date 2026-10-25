# Planning Decisions

**Plan**: [plan.md](specs/165-rebase-prs/plan.md)

- New module `src/git/rebasePrs.ts` with injected side effects: testable without `gh` or a model. Alternative: call `gitService` from the command.
- Detached worktree and `HEAD:refs/heads/<branch>` push with an explicit lease: no local branch to collide with `do-work`. Alternative: a temporary local branch.
- `REBASE_STRATEGY_ARGS` shared with `rebaseOnto()`: one copy of the strategy. Alternative: add `cwd` to every wrapper.
- `cwd` option on `runClaude` / `runCodex`: the model edits the worktree. Alternative: `process.chdir`.
- The command takes the `do-work` lock: the two cannot run together. Alternative: its own lock file.
- Executor, models and effort from `doWork.*`: the issue names that config. Alternative: duplicate keys.
