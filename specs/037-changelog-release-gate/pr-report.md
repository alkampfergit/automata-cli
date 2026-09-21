# PR Report: Changelog release gate

**Branch**: `feature/037-changelog-release-gate`
**Date**: 2026-09-21
**Spec**: [specs/037-changelog-release-gate/spec.md](../../specs/037-changelog-release-gate/spec.md)

## Summary

CI is red on every branch because the `0.8.0` release was tagged without rolling `CHANGELOG.md`'s `Unreleased` section,
and `tests/unit/changelog.test.ts` checks the file against `git tag` — which is repository-wide. This PR adds the
missing `## [0.8.0] - 2026-09-18` section, and stops the omission recurring by making `automata git publish-release`
refuse, read-only and before any ref is written, to release a version the changelog does not document.

## What's New

- **`CHANGELOG.md`**: the bullets that shipped as 0.8.0 are now filed under `## [0.8.0] - 2026-09-18` — the date the tag
  was created — with a fresh empty `## [Unreleased]` above them. Content is unchanged; only the heading moved, which is
  what the documented roll is.
- **`src/git/changelogGate.ts`** (new): a pure `checkChangelogSection(version, changelog)` that looks for a
  `## [X.Y.Z] - YYYY-MM-DD` heading, plus `readChangelog(dir)`, the one function that touches the filesystem. Modelled
  on `src/git/releaseVersion.ts` — release-time decisions kept out of `gitService.ts` and testable without a repository.
- **`automata git publish-release`**: a new precondition, running immediately after the "tag already exists" check, so a
  refusal predates every branch, merge, tag and push. The error names the exact heading expected and points at the roll
  procedure. It runs under `--dry-run` too, so a dry run is a faithful rehearsal.
- **Repositories without a changelog are unaffected**: an absent or unreadable `CHANGELOG.md` skips the check. The CLI
  is published for use against arbitrary repositories and must not invent a changelog requirement for them.
- **Docs**: `docs/git.md` documents the precondition; `docs/maintenance.md` records that the roll is now enforced rather
  than only written down.

## Testing

- **Unit — `tests/unit/changelogGate.test.ts`** (new, 14 tests): every branch of the decider — a matching heading, a
  missing one, an undated heading, a version named only in a bullet or a link-reference footer, a different version's
  heading, and `null` input; plus `readChangelog` against a temp directory for present, absent and unreadable files.
- **Unit — `tests/unit/git.commands.test.ts`** (extended): the command exits 1 and runs no `checkout`/`merge`/`tag`/
  `push` when the section is missing, proceeds when it is present, and refuses identically under `--dry-run`. The
  pre-existing precondition tests mock `readChangelog` to `null`, exercising the documented skip path, so none of them
  changed behaviour.
- **Unit — `tests/unit/changelog.test.ts`** (unchanged): the assertion that fails in run 35383728708 now reports zero
  undocumented versions. This is the check the PR exists to satisfy, and it was deliberately not weakened.
- **Full suite**: `npm test && npm run lint` green.

## Notes

- **0.8.0 was never published.** CI's `build` gates `publish`, which gates `release`, so the failing test stopped both:
  `npm view automata-cli dist-tags` still reports `latest: 0.7.0`, there is no `v0.8.0` tag and no GitHub release. This
  PR makes CI green and future releases correct; it does not restore the lost release.
- **Restoring 0.8.0 is a maintainer decision and is deliberately not in this PR.** Either the published `0.8.0` tag is
  moved onto a commit that contains this fix and CI re-run, or 0.8.0 is abandoned and 0.8.1 cut from the merged result.
  Both are irreversible from a consumer's point of view, so neither belongs in an automated change.
- The `## [X.Y.Z] - YYYY-MM-DD` pattern now exists in two places — `src/git/changelogGate.ts` and
  `tests/unit/changelog.test.ts`. That is deliberate: a test that imports the implementation it validates stops being an
  independent check. Each site carries a comment naming the other.
