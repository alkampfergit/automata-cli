# Plan: 183 clean-branches

1. `src/git/branchCleanup.ts`: pure planning (`planLocalCleanup`, `planRemoteCleanup`, `protectedBranches`) and
   `formatPlan`. No I/O.
2. `src/git/gitService.ts`: `fetchPruneOrigin`, `countUnpushedCommits`, `deleteRemoteBranch`.
   `src/github/ghWorkService.ts`: `listSameRepoPullRequestStates`.
3. `src/commands/git.ts`: the `clean-branches` subcommand (options, confirmation, execution, exit code).
4. Tests: `tests/unit/branchCleanup.test.ts`, `tests/unit/cleanBranches.cmd.test.ts`, wrapper argv tests.
5. Docs: `docs/git.md` section; README command table needs no change (group page exists); `CHANGELOG.md` bullet.

Constraints: spawnSync only; keep on every unanswerable question (null from wrappers); no stash/reset/clean.
