# Implementation Plan: A real, maintained CHANGELOG

**Branch**: `feature/035-real-changelog` | **Date**: 2026-09-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/035-real-changelog/spec.md`

## Summary

Rebuild `CHANGELOG.md` from the git tags: one dated Keep a Changelog section per published version (`0.1.0` through
`0.6.0`), an `Unreleased` section holding the work merged into `develop` since `0.6.0`, the convention for maintaining
it written down in `docs/maintenance.md` and pointed at from `docs/git.md` and `AGENTS.md`, and a unit test that fails
when the file's structure regresses or a released tag has no section. No source code changes.

## Technical Context

**Language/Version**: TypeScript 5.x (strict) for the new test; Markdown for the deliverable

**Primary Dependencies**: none added. The test uses `node:fs`, `node:path` and `node:child_process` (`execFileSync`
for `git tag`), all already used across `tests/unit`

**Storage**: N/A — repository files only

**Testing**: vitest (`npm test` → `npm run build && vitest run tests/unit`)

**Target Platform**: repository documentation; the npm tarball is unchanged (`files: ["dist", "README.md"]`)

**Project Type**: single-project CLI

**Performance Goals**: N/A. The new test reads one file and shells out to `git tag` once

**Constraints**: the changelog's versions come from git tags, never from `package.json`, which CI rewrites at publish
time; `X.Y.Z` and `vX.Y.Z` tags denote one version; markdown in this repo is not Prettier-formatted, so the new
sections match the neighbouring pages' style

**Scale/Scope**: 8 released versions, ~50 commits of reconstructed history, 4 files touched plus 1 new test

## Constitution Check

| Principle | Assessment |
|---|---|
| I. CLI-First Design | N/A — no command added or changed. The feature deliberately leaves `publish-release` alone (see research). |
| II. TypeScript Strictness | The new test is strict TypeScript, no `any`; parsing helpers carry explicit return types. |
| III. Single Responsibility | One new test file with one concern (changelog structure); no existing test is widened. |
| IV. npm Distribution | Unchanged. `CHANGELOG.md` is not added to `files`, so the tarball is byte-identical. |
| V. Simplicity | No new dependency, no generator, no script entry point. The check is a test because `npm test` is what already runs on every branch. |

Development Workflow clause — "after every completed SpecKit spec run, `README.md` MUST be reviewed": reviewed, no
change required. Installation, quick start, the command-group table and dev setup are all unaffected, and `AGENTS.md`
puts this kind of detail in `docs/`.

**Gate: PASS** (re-checked after design; no violations, Complexity Tracking not required).

## Project Structure

### Documentation (this feature)

```text
specs/035-real-changelog/
├── spec.md
├── plan.md              # This file
├── research.md          # Phase 0 output
├── tasks.md             # Phase 2 output
├── pr-report.md
└── spec-decisions.md
```

### Source Code (repository root)

```text
CHANGELOG.md                     # rewritten: Unreleased + 8 dated version sections + a short header
AGENTS.md                        # working defaults gain the "add an Unreleased bullet" rule
docs/
├── maintenance.md               # new "Changelog" section: the authoritative convention
└── git.md                       # publish-release gains a pointer to it
tests/
└── unit/
    └── changelog.test.ts        # new: structural + tag-coverage assertions
```

**Structure Decision**: no `src/` change. The deliverable is documentation, guarded by one test under the existing
`tests/unit/` directory alongside `ciAuditGate.test.ts`, which is the established home for "this policy must stay
true" assertions.

## Implementation Approach

1. **Reconstruct the history.** For each adjacent tag pair run `git log --no-merges --format='%s' <prev>..<tag>` and
   the tag's date; drop spec-kit bookkeeping subjects; group the rest into `Added` / `Changed` / `Fixed` / `Security`;
   rewrite each as the behaviour a reader would notice.
2. **Write `CHANGELOG.md`** newest-first, with a short header stating the format, that versions come from git tags, and
   where the maintenance rule lives.
3. **Write the convention** into `docs/maintenance.md`, with the release-time procedure (rename `Unreleased`, open a
   fresh one) and the division of labour with the auto-generated GitHub release notes; link it from `docs/git.md`'s
   `publish-release` section and from `AGENTS.md`'s working defaults.
4. **Add `tests/unit/changelog.test.ts`**: parse the file once, assert format invariants unconditionally, then assert
   tag coverage when `git tag` yields semver tags.
5. **Prove the test is not vacuous** by mutation — break a heading, reorder two versions, and delete a section, each
   must go red — then restore.
6. Run `npm test && npm run lint`.

## Complexity Tracking

No constitution violations; section intentionally empty.
