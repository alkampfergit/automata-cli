# Plan: rebase open pull requests onto their base

## Decisions

- Decision: a new module `src/git/rebasePrs.ts` holds the pure parts (skip decision, prompt, marker scan, comment) and
  an orchestrator that takes its side effects as a `RebaseDeps` object. Rationale: the whole flow is testable without
  `gh`, a model or a network. Alternatives considered: calling `gitService` directly from the command.
- Decision: the rebase runs in `git worktree add --detach <tmp>/pr-<n> origin/<branch>`, and the push is
  `HEAD:refs/heads/<branch>` with an explicit lease. Rationale: no local branch to collide with `do-work`'s branches;
  the lease names the sha the rebase started from. Alternatives considered: a temporary local branch.
- Decision: `REBASE_STRATEGY_ARGS` is exported from `gitService.ts` and used by both `rebaseOnto()` and the new module.
  Rationale: "reuse the strategy" without a second copy; `gitService`'s runner has no `cwd`. Alternatives considered:
  adding `cwd` to every wrapper.
- Decision: `runClaude` / `runCodex` get an optional `cwd`. Rationale: the model must edit the worktree, not the main
  checkout. Alternatives considered: `process.chdir` (breaks the run lock and the other pull requests).
- Decision: the command takes the `do-work` lock. Rationale: one lock, so `do-work` and `rebase-prs` cannot run
  together. Alternatives considered: its own lock file (would allow both to run).
- Decision: executor, models and effort come from `doWork.*`. Rationale: the issue names the existing executor
  config. Alternatives considered: a duplicate set under `git.rebasePrs`.
