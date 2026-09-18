# PR Report: Explicit branch-synchronisation strategy for `do-work`

**Branch**: `feature/036-explicit-rebase-sync`
**Date**: 2026-09-16
**Spec**: [specs/036-explicit-rebase-sync/spec.md](spec.md)

## Summary

`automata do-work` could be permanently unable to process a pull request whose local branch had diverged from its
remote, even when both tips carried identical content: the pull is `--ff-only` and the only recovery covered a force
push, so an equivalent divergence was skipped as `pull-failed` on every tick forever. This branch adds a third,
explicitly-named recovery — rebase onto the remote, but only when every local-only commit is provably already applied
upstream — and refuses everything else without moving a ref. It also refreshes the npm dependency references so a
release can be cut.

## What's New

- **`src/git/gitService.ts`**: three new primitives. `describeDivergence(upstream, head)` classifies
  `upstream..head` with `git cherry` (patch-id equivalence per commit) and counts merge commits separately, returning
  `null` when anything cannot be read. `rebaseOnto(ref)` and `abortRebase()` wrap the two rebase commands.
- **`src/git/workspaceService.ts`**: `preparePrBranch` now tries three recoveries in order — `--ff-only`, the existing
  force-push reset, and the new rebase onto `refs/remotes/origin/<branch>`. The rebase runs only when the range holds at
  least one commit, no merge commit, and every commit is already upstream. A conflict is aborted and returned as the new
  `rebase-conflict` reason; anything else is refused with a message naming the unpushed count and the
  `git log origin/<b>..<b>` command.
- **`PrepareResult` gains a required `strategy`** (`fast-forward` | `tracking-branch` | `reset-to-remote` | `rebase`) on
  its success variant, so an unhandled case is a compile error rather than a silent gap.
- **Explicit pull strategy everywhere**: `checkoutAndPull` (behind `automata git finish-feature`) was the last bare
  `git pull` in the CLI and now passes `--ff-only`. Nothing in the CLI depends on the machine's `pull.rebase` /
  `pull.ff` configuration — the failure mode quoted at the top of issue #73.
- **Operation log**: `TickLogItem` gains an optional `sync`. `automata-work.log` shows ` sync=<strategy>` per item;
  `automata-execution.log` gains an aggregate `sync=<strategy>:<count>,…` field whenever an item needed more than a
  fast-forward or could not be synchronised at all. The field is omitted entirely on an ordinary tick, so existing greps
  see a byte-identical line.
- **`do-work` progress output**: an item whose branch needed a reset or a rebase now says so on stderr. A plain
  fast-forward stays silent.
- **The base branch is untouched**: `prepareBaseBranch` and the hygiene pre-flight are still fast-forward-only, as the
  issue asks.
- **Dependency refresh**: `@types/node` 26.5.0 → 26.6.1, `prettier` 3.9.6 → 3.9.7, `vitest` 5.0.0 → 5.0.1, lockfile
  regenerated. `npm audit` and `npm audit --omit=dev` both report zero vulnerabilities after a clean `npm ci`.
- **Docs**: `docs/do-work.md` replaces "Force-pushed head branches" with a strategy table and the refusal contract;
  `docs/git.md` documents `finish-feature`'s `--ff-only`; `docs/wiki/Troubleshooting.md` rewrites the `pull-failed` row
  and adds `rebase-conflict`; `CHANGELOG.md` gains the `Unreleased` bullets.

## Breaking Changes

- **`PrepareResult`'s success variant now carries `strategy`** and `PrepareFailureReason` gains `rebase-conflict`. Both
  are internal types with no consumer outside this repository; the CLI's `--json` item shape is deliberately unchanged.
- **`automata git finish-feature` pulls `--ff-only`.** A `develop` that has diverged from its remote now fails the
  command instead of being merged or rebased according to local git configuration. Reconcile it by hand and re-run.

## Testing

- **Unit (mocked `spawnSync`)** — `tests/unit/workspaceService.test.ts` grew from 15 to 26 tests: the rebase path and its
  strategy, a merge commit in the range refusing, a non-upstream commit refusing without calling `rebaseOnto`, a
  conflicting rebase calling `abortRebase` and reporting `rebase-conflict`, an unreadable divergence refusing, a
  fast-forward never consulting the classification, and the force-push reset winning when both would apply.
- **Unit, real `git`** — `tests/unit/describeDivergence.git.test.ts` (new, 5 tests) builds scratch repositories and pins
  what `git cherry` actually does, including that it omits merge commits while `rev-list --merges` counts them. That
  single fact is what the safety guard rests on and no mock could have established it.
- **Integration, real `git` + real remote** — `tests/unit/preparePrBranch.git.test.ts` (new, 5 tests) clones a bare
  repository, sets `pull.rebase=false` in it on purpose, and reproduces issue #73 end to end: same parent, same tree,
  different shas. It asserts the branch lands on the remote tip with a clean tree, that a genuinely unpushed commit
  leaves the tip byte-identical, and that a dirty tree is refused first.
- **Unit** — `tests/unit/operationLog.test.ts` for the per-item field, the aggregate summary, field ordering against
  `note=`, and the newline-collapsing that protects the record format. `tests/unit/doWork.cmd.test.ts` for the progress
  line, the silence on a fast-forward, and the recorded strategy and refusal.
- **Mutation-proofed** — each new decision path was deleted or inverted in turn and the expected tests went red:
  loosening the safety predicate (3 red), removing `abortRebase` (2 red), announcing every strategy (2 red), emptying
  the quiet-strategy set (1 red), removing the rebase recovery (the end-to-end reproduction red).
- **Gate** — `npm test` 1121 passing across 36 files, `npm run lint` clean, `tsc --noEmit` clean, `npm audit` clean
  after `rm -rf node_modules && npm ci`.

## Notes

- **TypeScript stays on 5.9.3.** `npm outdated` offers 7.0.2, but constitution principle II fixes the stack at
  "TypeScript 5.x (strict mode)", so adopting the native-port compiler is a stack change needing its own amendment and
  its own `typescript-eslint` compatibility check. The Dependabot pull request for it is left open. `npm outdated` also
  still lists `@types/node` because DefinitelyTyped tags `22.x` as `latest`; the installed `26.6.1` is the highest
  published version and matches the declared range.
- **The release itself is the maintainer's step.** `package.json`'s `version` stays `0.1.0` — CI rewrites it from the
  git tag at publish time — so this branch only populates `CHANGELOG.md`'s `Unreleased`. To cut the release, rename that
  heading to `## [0.8.0] - <date>`, add a fresh empty `Unreleased`, commit on `develop`, then run
  `automata git publish-release 0.8.0`, exactly as `docs/maintenance.md` describes.
- **`prettier --check` still fails on `src/git/gitService.ts`, `src/git/workspaceService.ts` and
  `src/commands/doWork.ts`** — verified pre-existing by stashing this branch and re-running. `src/run/operationLog.ts`
  was clean on `develop` and was kept clean; both new test files pass `prettier --check`.
- **A `tracking-branch` strategy is rarer in practice than it looks.** `git checkout <branch>` guesses the branch from a
  single matching remote-tracking ref, so after the forced fetch it usually succeeds and the explicit
  `createTrackingBranch` fallback is not reached. Pinned in the integration test rather than assumed.
