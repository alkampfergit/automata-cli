# Spec Decisions: A real, maintained CHANGELOG

**Branch**: `feature/035-real-changelog`
**Date**: 2026-09-16
**Spec**: [specs/035-real-changelog/spec.md](../../specs/035-real-changelog/spec.md)
**Plan**: [specs/035-real-changelog/plan.md](../../specs/035-real-changelog/plan.md)
**Research**: [specs/035-real-changelog/research.md](../../specs/035-real-changelog/research.md)

## Planning Decisions

- **Format**: Keep a Changelog 1.1.0 — `## [X.Y.Z] - YYYY-MM-DD` headings with `Added` / `Changed` / `Fixed` /
  `Security` groups. **Rationale**: the convention npm consumers expect, trivially machine-checkable, and the existing
  `## [0.1.0] - Initial Release` heading is already the same shape minus the date. **Alternatives considered**:
  free-form prose (nothing to test, drifts again); a generator such as `conventional-changelog` (a dev dependency and a
  build step to reproduce the per-commit list GitHub already generates, over a pre-0.5.0 history that is not
  conventional — `Probably to delete`, `Restored configurartion`).
- **Source of truth for versions**: the git tags, not `package.json`. **Rationale**: `package.json` has read `0.1.0`
  since the first commit; CI derives the published version from the tag on `master` and rewrites the field with
  `npm version --no-git-tag-version` at publish time. **Alternatives considered**: asserting the changelog against
  `package.json` (would pin every release to `0.1.0`).
- **History granularity**: one bullet per user-visible change, merging a spec-kit run's follow-up commits into one.
  **Rationale**: GitHub release notes are already generated per commit, so the changelog's value is the human summary.
  **Alternatives considered**: per-commit bullets (duplicates the release notes, surfaces `docs: initialise PR
  artifacts`); minors only (loses `0.2.1` and `0.2.2`, and a missing version reads as a lost release).
- **Guard**: a vitest unit test, `tests/unit/changelog.test.ts`. **Rationale**: the repo already pins policy in tests
  (`ciAuditGate.test.ts` pins the `prepublishOnly` audit gate), and the file rotted for eight releases precisely
  because nothing failed when it did. **Alternatives considered**: no test (the failure mode the feature exists to
  stop); a `lint:changelog` npm script (a second entry point for what `npm test` already runs on every branch).
- **Tag coverage in an incomplete clone**: report that the check could not run; keep the format assertions
  unconditional. **Rationale**: CI checks out with `fetch-depth: 0` and `fetch-tags: true`, but a shallow clone has no
  tags, and a suite that fails on how the repository was cloned gets ignored. **Alternatives considered**: hard-failing
  (environment-dependent); a hard-coded version list (stale the moment `0.7.0` ships).
- **Home of the convention**: `docs/maintenance.md`, linked from `docs/git.md` and `AGENTS.md`. **Rationale**:
  `AGENTS.md` reserves `docs/<group>.md` for command groups; the changelog is release policy, and `maintenance.md`
  already holds that kind of policy (audit gate, Dependabot scope, deferred upgrades). **Alternatives considered**: a
  new `docs/changelog.md` (a page for one convention, and the README command table would want a row for a non-command);
  stating it only inside `CHANGELOG.md` (contributors do not open the file they are forgetting to update).
- **`publish-release` left alone**: the `Unreleased` → version roll stays manual. **Rationale**: issue #71 asked to
  modify the changelog; automating the roll needs its own precondition, `--dry-run` output and a failure mode
  mid-release-sequence. **Alternatives considered**: doing it now (scope creep into the command that performs an
  irreversible push).
- **Project structure**: no `src/` change; the only new file outside `specs/` is a test under the existing
  `tests/unit/`. **Rationale**: the deliverable is documentation. **Alternatives considered**: a changelog-checking
  module under `src/` (dead weight — nothing in the CLI consumes it).
