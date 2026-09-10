# PR Report: `do-work` pre-flight repository hygiene

**Branch**: `feature/032-do-work-repo-hygiene`
**Date**: 2026-09-10
**Spec**: [specs/032-do-work-repo-hygiene/spec.md](../../specs/032-do-work-repo-hygiene/spec.md)

## Summary

`automata do-work` now opens every tick by putting the checkout into a known state instead of
assuming one. Uncommitted changes are committed, pushed and given a draft pull request rather
than causing every work item to skip with `dirty-tree`; the base branch is checked out and
fast-forwarded on every tick, including one with nothing to do; and local branches that exist on
no remote and whose work has provably landed are deleted — the rest are pushed with a draft pull
request instead.

No new flag, no new config key. `automata do-work --dry-run` previews the whole pre-flight and
changes nothing.

## What's New

- **`src/git/repoHygiene.ts` (new)**: the once-per-tick pre-flight — sequencing plus the
  keep/delete/rescue decisions. It sits beside `workspaceService.ts`, which stays the *per-item*
  checkout guard: the two are the same kind of module, differing only in scope. The hard rule is
  inherited unchanged — no step stashes, resets, cleans, force-checkouts or merges.
- **Rescue instead of refuse**: on a dirty tree (still ignoring `.automata/automata.lock`) the
  changes are committed onto the branch already checked out, or onto a new
  `rescue/<source>-<YYYYMMDDTHHMMSSZ>` branch when HEAD is the base branch or detached, then
  pushed and given a draft pull request — unless the branch already has an open one. `do-work`
  still never commits to or pushes the base branch. Every step is additive, so a failure at any
  of them leaves the tree exactly as dirty as it was and the pre-existing per-item `dirty-tree`
  skip still protects the work.
- **Unconditional base-branch refresh**: `git checkout <base>` then `git pull --ff-only` runs on
  every tick, so a tick with nothing to do still ends on the base branch at the remote's tip. A
  diverged base branch fails loudly rather than being merged, rebased or reset.
- **Branch prune**: candidates are local branches whose name is absent from one
  `git ls-remote --heads origin` (one network call, not one per branch), excluding the base
  branch, the checked-out branch and `doWork.protectedBranches`. An `OPEN` pull request keeps a
  branch; a `MERGED` one deletes it; otherwise a confirmed zero commits outside the base branch
  deletes it and anything more gets pushed with a draft pull request and **kept**. Any
  uncertainty — unreachable `origin`, failed lookup, unparseable count, failed delete — keeps the
  branch and marks the tick degraded.
- **`src/git/gitService.ts`**: eight new wrappers (`listLocalBranches`, `listRemoteBranches`,
  `createBranchAtHead`, `stageAllExcept`, `commitStaged`, `pushSetUpstream`, `countCommitsNotIn`,
  `forceDeleteLocalBranch`). `listRemoteBranches` returns `null` rather than `[]` when the remote
  cannot be asked, and `countCommitsNotIn` returns `null` on any unanswerable question — the two
  distinctions the prune step's safety rests on.
- **`src/github/ghWorkService.ts`**: `listPullRequestsForHead` (every state for a named head,
  newest first) and `createDraftPullRequest` (`--head`, so no checkout is needed; `--label rescue`
  applied best-effort with one retry without it).
- **`src/commands/doWork.ts`**: the pre-flight runs in `runTick` inside the run lock and before
  issue discovery, reports on stderr as it goes and again in the stdout summary, appears as a
  `preflight` object under `--json`, is honoured by `--dry-run`, and forces exit 2 when degraded.
- **Docs**: a new "The repository-hygiene pre-flight" section in `docs/do-work.md`, plus the
  amended "How it works" step order, `--dry-run` option row, exit-code notes and "What `do-work`
  never does" list. Three statements in `docs/wiki/` that this change made false were corrected.

## Breaking Changes

- **A dirty working tree no longer skips every work item.** It is committed and pushed instead.
  Anyone relying on `do-work` leaving local changes alone should know that a tick will now push
  them to a branch and open a draft pull request. Nothing is ever discarded, and `--dry-run`
  previews it.
- **`do-work` now deletes local branches.** Only ones absent from `origin` whose work has provably
  landed, never the base branch, the checked-out branch or a `doWork.protectedBranches` entry.
- **Exit 2 has a new cause**: a degraded pre-flight, on a tick whose items all succeeded. Exit 0,
  1 and the existing meaning of 2 are unchanged.

## Testing

- **Unit — `tests/unit/repoHygiene.test.ts` (40 tests)**: the whole decision surface with both
  service modules mocked. One case per acceptance scenario, plus the failure path of every rescue
  step, the squash-merge case, the "uncertainty keeps the branch" cases (unreachable `origin`,
  failed pull-request lookup, unparseable count, failed delete), step ordering asserted with a
  shared `order` array, and a dry run proven to issue no call from an explicit mutator list.
- **Unit — `tests/unit/gitService.hygiene.test.ts` (18 tests)**: the exact argv of each new git
  wrapper against a mocked `spawnSync`, plus the `null`-vs-empty distinctions.
- **Unit — `tests/unit/ghWorkService.test.ts` (extended)**: argv and normalisation of both `gh`
  wrappers, including that a missing label triggers exactly one retry without `--label` and that
  an unrelated failure triggers none.
- **Unit — `tests/unit/doWork.cmd.test.ts` (extended)**: the pre-flight runs exactly once, before
  discovery, is not run at all when the lock is held, receives the configured base and protected
  branches and the dry-run flag, appears in the human summary and in both `--json` payloads, and
  turns an otherwise-healthy tick into exit 2 when degraded.
- **End-to-end (read-only)**: `node dist/index.js do-work --dry-run --limit 1` run against this
  repository, which is how the squash-merge problem was found — it initially queued
  `feature/update-spec-kit` for a rescue, and after the fix reports
  `would delete feature/update-spec-kit (no remote, PR #33 was merged)`.
- **Gates**: `npm test` 789 passed / 29 files, `npm run lint` (`eslint src/`) clean,
  `tsc --noEmit` clean, `prettier --check` clean on every new file.

## Notes

- **Not run for `--dry-run`'s sake alone, but worth watching on the first real tick**: the prune
  step deletes branches, so review one `--dry-run` in your own checkout before the next cron tick
  fires. This repository's own dry run would delete one branch and rescue one.
- **Per-item `prepareBaseBranch` / `preparePrBranch` were deliberately left in place.** The
  original sketch on issue #47 said the base checkout would be hoisted out of the item loop
  entirely; on inspection those calls are also the guard that stops item N+1 running on item N's
  leftovers, so they stay. The cost is one extra already-current fast-forward pull per item.
- **The `rescue` label is not created.** If your repository has not defined it, pull-request
  creation retries without it — creating the label would be a write to repository settings this
  change was not asked to make. Define it by hand if you want to filter on it.
- **`docs/wiki/` was touched** beyond the usual `docs/<group>.md` because three sentences there
  ("a dirty working tree skips the item", the `dirty-tree` troubleshooting row, and the "never
  discards" list) became false with this change. `README.md` needed no change: it only links to
  `docs/do-work.md`.
