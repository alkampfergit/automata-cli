# Quickstart: `do-work` pre-flight repository hygiene

**Feature**: `feature/032-do-work-repo-hygiene` | **Date**: 2026-09-10

## What changed for an operator

Nothing to configure and no new flag. `automata do-work` now opens every tick by putting the
checkout in a known state.

## Preview it without touching anything

```bash
automata do-work --dry-run
```

Output gains a pre-flight block before the work plan:

```text
Pre-flight:
  rescue    would commit 3 change(s) onto feature/031-update-all-npm and push it
  base      would check out develop and pull --ff-only
  prune     would delete feature/old-thing (no remote, PR #12 MERGED, 0 commits outside develop)
  prune     kept fix/wip (no remote, no open PR, 4 commit(s) outside develop — would push + open a draft PR)
```

`--dry-run --json` returns the same as a `preflight` object alongside `plan` and `items`.

## Confirm the dirty-tree rescue

```bash
echo scratch > scratch.txt            # untracked
automata do-work --max-runs 0         # pre-flight runs; no model run
git status --porcelain                # clean
gh pr list --label rescue --state open
```

The change is committed, pushed, and carries a draft pull request against `develop`. If the
checkout was already on a feature branch, the commit lands on that branch instead of a new one,
and no second pull request is opened when it already has an open one.

## Confirm the prune

```bash
git branch --no-track wip/dead develop   # exists on no remote, no PR, nothing outside develop
automata do-work --dry-run               # reports "would delete wip/dead"
automata do-work --max-runs 0            # deletes it
git branch --list wip/dead               # empty
```

A branch carrying commits `develop` does not have is pushed with a draft pull request instead of
being deleted — run the same steps after `git commit --allow-empty -m x` on it to see that path.

## Exit codes

Unchanged: 0 healthy, 1 precondition failure before anything was attempted, 2 degraded. A
pre-flight step that failed makes an otherwise-healthy tick exit 2 and names the failure in the
summary.

## Tests

```bash
npm test -- repoHygiene
npm test && npm run lint
```
