# Spec Decisions: Changelog release gate

**Branch**: `feature/037-changelog-release-gate`
**Date**: 2026-09-21
**Spec**: [specs/037-changelog-release-gate/spec.md](../../specs/037-changelog-release-gate/spec.md)
**Plan**: [specs/037-changelog-release-gate/plan.md](../../specs/037-changelog-release-gate/plan.md)
**Research**: [specs/037-changelog-release-gate/research.md](../../specs/037-changelog-release-gate/research.md)

## Planning Decisions

- **Fix the changelog, not the test**: add the missing `0.8.0` section and leave `tests/unit/changelog.test.ts`
  untouched. **Rationale**: the assertion is on its first true positive — 035 built it precisely because the file had
  rotted with nothing to notice. Relaxing it in response to the failure it was written to catch removes the only
  detection there is. **Alternatives considered**: an allow-list excluding `0.8.0` (a permanent record of a temporary
  omission, which the next omission gets appended to); deleting the `0.8.0` tag (rewrites published release history, and
  the tag is what CI derives the published version from).

- **The guard is a `publish-release` precondition**: not a CI step, not a git hook, not a new subcommand.
  **Rationale**: it has to refuse *before* the tag exists. A CI check runs after the tag is on the trunk — exactly the
  state issue #80 is in, where recovery now costs a moved tag or a burned version. A precondition is also the only form
  a `--dry-run` can rehearse. **Alternatives considered**: a workflow step (strictly later than the tag, and needs the
  `workflow` OAuth scope that project memory records as a recurring obstacle); `automata changelog check` (another
  command to remember to run, which is the reliance on memory that failed here); a git hook (not versioned by default,
  bypassed with `--no-verify`).

- **An absent or unreadable `CHANGELOG.md` passes**: the gate skips rather than failing closed. **Rationale**: the CLI
  is published and run against other repositories, most of which keep no changelog; failing closed would make
  `publish-release` unusable for them — a larger regression than the bug being fixed. **Alternatives considered**:
  failing closed (right for this repository, wrong for every consumer); a `--skip-changelog-check` flag or a
  `changelog.required` config key (an opt-out gets used in exactly the situation the gate exists for, and a config key
  would additionally owe a `config set` subcommand and a wizard screen under the project's "reachable two ways" rule).

- **Match `## [X.Y.Z] - YYYY-MM-DD` exactly, duplicating the test's pattern**: the gate accepts only the heading shape
  `tests/unit/changelog.test.ts` accepts. **Rationale**: the gate's purpose is keeping that test green; a looser match
  would pass a release the test then fails, leaving the same red build with indirection in front of it.
  **Alternatives considered**: a substring search for the version (matches the link-reference footer and any bullet
  naming it); sharing one pattern between `src/` and the test (a test that imports the implementation it validates stops
  being an independent check — so the duplication is deliberate, and each site carries a comment naming the other).

- **Structure — a pure decider in `src/git/changelogGate.ts`, I/O confined to one function**: `checkChangelogSection` is
  pure; `readChangelog(dir = process.cwd())` is the single filesystem entry point and its whole body is a silent
  `try`/`catch`. **Rationale**: mirrors `src/git/releaseVersion.ts`, which exists for the same reason — release-time
  decisions kept out of the module that owns the private `spawnSync` runner, so every branch is testable without a
  repository, and the defaulted `dir` lets a test point at a temp directory without stubbing `process.cwd`.
  **Alternatives considered**: inlining the read and the regex in `src/commands/git.ts` (the action is already ~90 lines
  and each branch would need the full `spawnSync` stub table to reach); adding it to `gitService.ts` (inherits the need
  to mock `node:child_process`).

- **The command tests mock `readChangelog`, defaulting to `null`**: via a `vi.mock` factory that spreads
  `importOriginal()`. **Rationale**: the existing `publish-release` CLI tests release `1.3.0` against the real working
  directory, whose changelog has no `1.3.0` section, so a gate reading the real file would fail eleven unrelated tests;
  defaulting to `null` keeps them on the documented skip path. The `importOriginal()` spread is the form project memory
  records as immune to a missing named export blanking an entire test file. **Alternatives considered**: a real
  `CHANGELOG.md` in a temp cwd (adds a `process.chdir` to a suite that has none, and `publish-release` resolves nothing
  else relative to cwd); adding a `1.3.0` section to the repository's changelog (documents a version that does not
  exist).

- **Republishing 0.8.0 is out of scope**: the PR restores CI and prevents recurrence; it does not restore the release.
  **Rationale**: recovery means either moving the published `0.8.0` tag onto a commit containing the fix or cutting
  0.8.1 instead. Both touch npm and GitHub releases and are irreversible from a consumer's point of view, so the choice
  belongs to the maintainer. **Alternatives considered**: moving the tag as part of this branch (an automated change
  rewriting published release history); cutting 0.8.1 here (burns a version number on the maintainer's behalf).
