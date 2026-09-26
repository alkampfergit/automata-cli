# PR Report: Trunk-based release flow

**Branch**: `feature/039-trunk-release-flow`
**Date**: 2026-09-26
**Spec**: [specs/039-trunk-release-flow/spec.md](specs/039-trunk-release-flow/spec.md)

## Summary

`automata git publish-release` now releases from repositories that only have `main` or `master`, as well as from GitFlow
repositories. The flow is detected from whether `origin` has a `develop` branch, or pinned with `git.releaseFlow`. On
the trunk flow the command creates an empty release commit on the trunk, tags it, and pushes the branch and the tag in
one atomic push, so the existing branch-push CI publishes the release.

## What's New

- **`publish-release` release flow**: the flow, `gitflow` or `trunk`, is resolved after the trunk branch and printed
  as `Release flow: <flow> (<source>)`. It comes from `git.releaseFlow`, or when that is unset from
  `git ls-remote --exit-code --heads origin develop`. A failed probe or an invalid configured value refuses the release
  rather than guessing a flow.
- **Trunk flow**: it runs from the trunk branch, and the trunk may be ahead of `origin` but not behind. It runs
  `git commit --allow-empty -m "chore(release): <version>"`, `git tag <version>`, and
  `git push --atomic origin <trunk> <version>`. The empty commit guarantees the trunk ref moves, so branch-push CI
  fires. The atomic push guarantees the tag arrives with the branch, so CI finds it on `HEAD`. There is no release
  branch, no merge and no `package.json` bump.
- **GitFlow flow**: unchanged. Its step list moved into the pure `planRelease()` in `src/git/releaseFlow.ts`, and
  `publishRelease()` now only prints or executes the plan.
- **Branch precondition**: `checkReleasePreconditions(expectedBranch)` requires `develop` for gitflow and the trunk for
  the trunk flow.
- **Configuration**: the new `git.releaseFlow` key, `automata config set git-release-flow <gitflow|trunk>`, and a
  `Git — Release Flow` wizard screen after the trunk branch screen. Its "Detect from origin" option clears the key.
- **Docs**: `docs/git.md` covers both sequences, detection, the CI expectation and failed-push recovery.
  `docs/config.md` documents the key. There is also a `CHANGELOG.md` `Unreleased` entry and a one-line README
  correction.

## Testing

- **Unit (pure)**: `tests/unit/releaseFlow.test.ts` covers validation, provenance text and both step lists. The trunk
  plan has exactly three steps, with no `develop`, `merge` or `release/`.
- **Unit (service)**: `tests/unit/publishRelease.test.ts` covers the three probe outcomes (0, 2, and other), flow
  resolution (configured, invalid, detected either way, probe failure), the trunk argv order, a failed push, and a
  trunk dry run that executes nothing.
- **Unit (CLI)**: `tests/unit/git.commands.test.ts` covers the detected gitflow line, a trunk dry run, a real trunk run
  with the command order, off-trunk and behind refusals, a configured flow skipping the probe, and refusals for an
  invalid config and a failed probe.
- **Config**: setter tests in `tests/unit/config.cmd.test.ts` and wizard navigation and save tests in
  `tests/unit/ConfigWizard.test.tsx`.
- **Mutation**: dropping `--atomic`, reading a probe error as "absent", always requiring `develop`, and dropping the
  empty commit each turn the suite red.
- **Manual end-to-end**: the built CLI ran against a scratch bare `origin` with only `master`, from a
  `--single-branch` clone. The dry run matched the real run. The real run pushed an unpushed roll commit, the empty
  release commit and tag `1.1.0` in one push, and an off-trunk run was refused.
- `npm test` (1383 tests) and `npm run lint` are green.

## Notes

- Other repositories using the trunk flow need CI that publishes from the trunk-branch push when a version tag is on
  `HEAD`. This repository's `ci.yml` already works that way, so no CI change is included.
- This repository has `origin/develop`, so its own releases keep detecting `gitflow`.
