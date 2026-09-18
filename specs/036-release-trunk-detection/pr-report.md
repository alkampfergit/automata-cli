# PR Report: Release Trunk Detection

**Branch**: `feature/036-release-trunk-detection`
**Date**: 2026-09-18
**Spec**: [specs/036-release-trunk-detection/spec.md](spec.md)

## Summary

`automata git publish-release` assumed the trunk branch is called `master` and that it exists
locally, so on a clone that only checked out `develop` it stopped with "No semver tag found on
master" — and it failed for a second, independent reason on any repository whose trunk is `main`.
This change resolves the trunk name from the remote (with an optional config override), fetches tags
and the trunk ref before inferring a version, and threads the resolved name through every step of the
release sequence.

## What's New

- **Trunk resolution** (`src/git/trunkDetection.ts`, new): pure helpers that parse `origin/HEAD` and
  the `ls-remote --symref` line, hold the probe order, and build the two operator-facing messages.
  Pure so the parsing cases are testable without running `git`; every `spawnSync` call stays in
  `gitService`, which owns the runner.
- **`resolveTrunkBranch()`** (`src/git/gitService.ts`): config override → `origin/HEAD` →
  `git ls-remote --symref origin HEAD` → probe `origin/main` / `origin/master`. Returns the source
  alongside the name, so the command can say where it came from. On failure it returns every
  candidate it tried.
- **`fetchTrunkAndTags()`**: runs `git fetch --tags origin +refs/heads/<trunk>:refs/remotes/origin/<trunk>`
  before the version is inferred, in `--dry-run` too. The refspec is explicit because a
  `--single-branch` clone's configured refspec would otherwise leave `origin/<trunk>` uncreated.
- **`getLatestTagOnTrunk(ref)`** replaces `getLatestTagOnMaster()`: it describes the ref it is given,
  normally `origin/<trunk>`, so no local trunk branch is needed to infer a version.
- **Behind-check** (`trunkBehindCount()` + a new precondition): a local trunk branch behind
  `origin/<trunk>` aborts with the branch name and the commit count. It is never fast-forwarded — it
  may carry work this command knows nothing about.
- **`publishRelease(version, dryRun, trunk)`**: the checkout, merge, tag and push steps use the
  resolved name. When the local trunk is absent the step becomes
  `git checkout -b <trunk> origin/<trunk>` — deliberately without `--track`, which git rejects in a
  `--single-branch` clone.
- **`publish-release` output**: prints `Trunk branch: <name> (<source>)` before anything happens, and
  the "no semver tag" error now names `origin/<trunk>` rather than `master`.
- **`git.trunkBranch` config key**: new top-level `git` section, unset by default, reachable from
  `automata config set git-trunk-branch <name>` and a `Git` screen appended to the wizard's main menu
  (blank clears it, restoring detection).
- **Docs**: `docs/git.md` gains the detection order, the fetch behaviour, the reworked preconditions
  table and the updated sequence; `docs/config.md` gains a `git` section; `README.md` and
  `docs/maintenance.md` no longer state that the version comes from a tag on `master`.

## Breaking Changes

- **`getLatestTagOnMaster()` is gone**, replaced by `getLatestTagOnTrunk(ref)`, and `publishRelease()`
  takes a third `trunk` argument. Both are internal module exports with no consumers outside this
  repository, so there is no user-visible migration.
- **`publish-release` now performs a network fetch on every run, including `--dry-run`.** A run with
  no access to `origin` that previously reached the git sequence now stops at the fetch — deliberate:
  the command's last step is a push, so such a run could not have succeeded anyway.

## Testing

- **Real-git probes (manual, recorded in `research.md`)**: every git behaviour the design rests on was
  measured in two throwaway repositories — a full clone and a `git clone --single-branch --branch
  develop` clone. This is where `--track` was found to fail and where the bare `git fetch origin
  <trunk>` was found not to create `origin/<trunk>`; both findings changed the implementation.
- **Unit — `tests/unit/trunkDetection.test.ts` (new, 14 tests)**: the two parsers against real captured
  output (tab-separated symref line, absent `origin/HEAD`, slash-bearing branch name), the probe order,
  and the wording of both messages.
- **Unit — `tests/unit/publishRelease.test.ts`**: resolution through all four rungs and the
  unresolved case; the fetch refspec and its error passthrough; the behind-count including the
  no-local-branch short circuit; the release sequence against a resolved trunk; the
  `checkout -b <trunk> origin/<trunk>` form with an assertion that `--track` is absent; and a dry run
  asserted against an explicit `MUTATORS` list.
- **CLI — `tests/unit/git.commands.test.ts`**: the stub now dispatches on argv rather than call order.
  Covers every precondition plus four new failure modes (unresolvable trunk, failed fetch, behind
  local trunk, configured override skipping detection) and one happy path that reproduces the reported
  scenario: a develop-only clone inferring `0.7.0 → 0.8.0` from `origin/main` while mutating nothing.
- **CLI — `tests/unit/config.cmd.test.ts`**: the new setter, its empty-value rejection, and that it
  leaves the rest of the config alone.
- **Wizard — `tests/unit/ConfigWizard.test.tsx`**: the new menu entry and screen, saving a value,
  clearing it, and Esc navigation.
- **Mutation testing**: eight mutations were applied one at a time and each turned tests red —
  detection disabled, `--track` reinstated, the bare fetch form, the behind-check removed, the fetch
  removed, inference pointed back at local `master`, the wizard write removed, and the symref parser's
  whitespace split removed. All were reverted.
- **End-to-end smoke (real `git`, throwaway repos)**: `--dry-run` in both clone shapes; a **complete
  real release** from a develop-only clone against a bare remote (trunk created from `origin/master`,
  merged, tagged, pushed — verified on the remote); the behind-refusal; and the unresolvable-trunk
  error.
- **Gate**: `npm test` → 35 files, 1132 tests passing. `npm run lint` (`eslint src/`) clean.

## Notes

- `publish-release` still requires `develop` as the current branch and still names `develop` in its
  merge-back and push steps. Only the trunk side is detected; generalising the develop side was not
  requested and is a separate change.
- The remote is still assumed to be `origin`, as it is everywhere else in `src/git/gitService.ts`.
- `npx prettier --check` fails on the five pre-existing `src/` files this branch touches. Verified
  against `develop` that each already failed before the change; both new files pass.
