# Tasks: A real, maintained CHANGELOG

**Feature Branch**: `feature/035-real-changelog` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Ordering: the history must be reconstructed before it can be written (T002 → T004), and the file must exist before the
test can meaningfully run (T004 → T006). Documentation tasks (T007–T009) are independent of the test tasks and may run
in parallel `[P]`.

## Phase 1: Research the record

- [X] **T001** Establish how a release happens: read `.github/workflows/ci.yml`, `docs/git.md` (`publish-release`) and
  `package.json`, and record in `research.md` that the version comes from the git tag, not `package.json`, and that two
  tags (`X.Y.Z`, `vX.Y.Z`) exist per release. *(FR-002, edge cases)*
- [X] **T002** For each adjacent tag pair, capture `git log --no-merges --format='%s' <prev>..<tag>` and the tag date
  from `git for-each-ref`. Covers `0.1.0`, `0.2.0`, `0.2.1`, `0.2.2`, `0.3.0`, `0.4.0`, `0.5.0`, `0.6.0`. *(FR-001)*
- [X] **T003** Capture `git log --no-merges --format='%s' 0.6.0..develop` for the `Unreleased` section. *(FR-003)*

## Phase 2: Write the changelog

- [X] **T004** Rewrite `CHANGELOG.md`: a short header (format, versions come from tags, pointer to the convention),
  `## [Unreleased]` first, then the 8 version sections newest-first as `## [X.Y.Z] - YYYY-MM-DD`, bullets grouped under
  `Added` / `Changed` / `Fixed` / `Security`. *(FR-001, FR-002, FR-003, FR-004)*
- [X] **T005** Drop spec-kit bookkeeping subjects (`docs: initialise PR artifacts`, `docs: finalise PR artifacts`,
  `docs: refresh speckit memory`) and internal refactors; verify by re-reading each range that no user-visible change
  was dropped with them. *(FR-005, SC-003)*

## Phase 3: Guard the structure

- [X] **T006** Add `tests/unit/changelog.test.ts`: `Unreleased` present and first; every version heading matches
  `## [X.Y.Z] - YYYY-MM-DD`; versions strictly descending by semver; dates non-increasing; only known category
  headings; every semver git tag (with `v` normalised away) has a section; the tag check reports rather than fails when
  no tags are available. *(FR-009, FR-010)*
- [X] **T007** Prove the test is not vacuous by mutation, in three directions: break a heading's date, swap two version
  sections, delete a version section — each must turn the suite red — then restore the file. *(SC-004)*

## Phase 4: Write down the convention

- [X] **T008** [P] Add a `Changelog` section to `docs/maintenance.md`: format and categories, when a bullet is added,
  what `publish-release` time does to `Unreleased`, why the file exists alongside auto-generated GitHub release notes,
  and that `package.json`'s version is not the release version. *(FR-006, SC-005)*
- [X] **T009** [P] Link it from `docs/git.md`'s `publish-release` section as a pre-release step. *(FR-007)*
- [X] **T010** [P] Add the rule to `AGENTS.md`'s working defaults: a user-visible change gets an `Unreleased` bullet.
  *(FR-008)*
- [X] **T011** [P] `grep -rn -i changelog docs/ README.md AGENTS.md` to confirm no existing page contradicts the new
  convention (per the `docs/wiki/` lesson in speckit memory).

## Phase 5: Verify

- [X] **T012** Run `npm test && npm run lint`; both green.
- [X] **T013** Review `README.md` per the constitution's Development Workflow clause and record the outcome in
  `plan.md` (expected: no change — installation, quick start, command table and dev setup are unaffected).
