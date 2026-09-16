# PR Report: A real, maintained CHANGELOG

**Branch**: `feature/035-real-changelog`
**Date**: 2026-09-16
**Spec**: [specs/035-real-changelog/spec.md](../../specs/035-real-changelog/spec.md)

## Summary

`CHANGELOG.md` has said `0.1.0 - Initial Release` since the first commit, while eight versions shipped to npm. This
rebuilds it from the git tags — one dated section per released version plus an `Unreleased` section for what is queued
for the next tag — writes down the convention for keeping it current, and adds a test that fails if the structure
regresses or a released tag has no section. No source code changes.

## What's New

- **`CHANGELOG.md`**: rewritten in [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) form. Sections for
  `0.6.0`, `0.5.0`, `0.4.0`, `0.3.0`, `0.2.2`, `0.2.1`, `0.2.0` and `0.1.0`, each dated from its tag and reconstructed
  from `git log <prev>..<tag>`, newest first. Bullets describe behaviour, not commit subjects; the spec-kit bookkeeping
  commits (`docs: initialise PR artifacts` and friends) are excluded.
- **`Unreleased` section**: the work merged into `develop` since `0.6.0` — the unassigned-only claim rule (033), the
  rescue fixes and pre-flight cause reporting (034), the orphan-PR plan line, and the Dependabot scope change (#68).
  This is what a `0.7.0` cut renames.
- **`docs/maintenance.md` → new `Changelog` section**: the authoritative convention. Format and categories; that the
  version headings come from git tags and *not* `package.json` (CI rewrites that field at publish time, and two tags —
  `0.6.0` and `v0.6.0` — exist per release); that a bullet is added with the change on the feature branch, not at
  release time; the three manual steps that roll `Unreleased` into a version before `publish-release` runs; and why the
  file is worth keeping when GitHub already generates per-commit release notes.
- **`docs/git.md`**: `publish-release` gained a *Before you run it* note — the command does not touch `CHANGELOG.md`,
  and it requires a clean tree, so the roll has to be committed first.
- **`AGENTS.md`**: a working default stating that a user-visible change gets an `Unreleased` bullet in the same commit,
  and that internal refactors and spec-kit artifacts do not.
- **`tests/unit/changelog.test.ts`**: five assertions guarding the structure, alongside `ciAuditGate.test.ts` which
  pins release policy the same way.

## Testing

- **Unit (`tests/unit/changelog.test.ts`, 5 tests)**: `Unreleased` present and above every version section; every
  version heading matches `## [X.Y.Z] - YYYY-MM-DD` and parses as a date, with no other `## [` heading tolerated;
  versions strictly descending with dates that never move backwards; only Keep a Changelog categories used; every
  semver git tag has a section, with `v` normalised away.
- **Mutation (manual, five directions)**: each assertion was proven non-vacuous by breaking the file and confirming it
  went red — an undated heading (`## [0.3.0] - Spring Release`), a deleted `0.2.1` section, `0.3.0` and `0.2.2`
  swapped, `### Fixed` renamed to `### Bugfixes`, and `Unreleased` moved below `0.6.0`. Each mutation failed exactly
  the intended test (the undated heading also failed tag coverage, correctly — an unparseable heading documents no
  version). File restored afterwards.
- **Suite**: `npm test` → 34 files, 1094 tests passing. `npm run lint` and `npm run typecheck` clean.

## Notes

- **The `Unreleased` → version roll is manual.** `automata git publish-release` was deliberately not changed:
  automating it needs its own precondition, `--dry-run` output and a mid-release failure mode. Issue #71's `0.7.0` cut
  should rename `## [Unreleased]` to `## [0.7.0] - <date>`, open a fresh empty one, commit, then run the command — the
  three steps are in `docs/maintenance.md`. Worth its own issue if the manual step proves fragile.
- **`CHANGELOG.md` is not published.** `package.json`'s `files` is still `["dist", "README.md"]`, so the npm tarball is
  unchanged. Adding the changelog to it is a packaging decision, left alone here.
- **The reconstructed entries are a best-effort summary**, written from commit subjects for ranges up to 18 months old.
  Where a range's intent was ambiguous the bullet stays close to what the subject claimed rather than inventing detail.
- **`README.md` is untouched** — installation, quick start, the command-group table and dev setup are all unaffected,
  and `AGENTS.md` puts this kind of detail in `docs/`.
