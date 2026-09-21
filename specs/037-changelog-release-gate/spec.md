# Feature Specification: Changelog release gate

**Feature Branch**: `feature/037-changelog-release-gate`

**Created**: 2026-09-21

**Status**: Draft

**Input**: User description: "Fix CI failing on master: the 0.8.0 release was tagged without rolling CHANGELOG.md's Unreleased section, so tests/unit/changelog.test.ts fails on every branch. Add the missing 0.8.0 section and guard publish-release against tagging a version with no changelog section."

## Context

Issue #80 reports [CI run 35383728708](https://github.com/alkampfergit/automata-cli/actions/runs/35383728708) failing on
`master`. The failure is one assertion:

```
FAIL tests/unit/changelog.test.ts > CHANGELOG.md structure > has a section for every released tag
AssertionError: released versions with no CHANGELOG.md section: expected [ '0.8.0' ] to deeply equal []
```

The `0.8.0` tag exists on `master` (commit `f9b9bc6`, `Merge branch 'release/0.8.0'`, 2026-09-18) but `CHANGELOG.md` has
no `## [0.8.0]` section — its top released heading is still `## [0.7.0] - 2026-09-16`, with the 0.8.0 content sitting
unrolled under `## [Unreleased]`.

`docs/maintenance.md` documents the roll as a **manual** step that must land on `develop` *before*
`automata git publish-release` runs. For 0.8.0 it did not happen, and nothing refused the release. The structural test
added in 035 is the only thing that noticed — after the fact, on every branch, because git tags are repository-wide.

The failure is not confined to cosmetics. CI's `build` job gates `publish`, which gates `release`, so the red build
means **0.8.0 never shipped**: npm `latest` is still `0.7.0`, no `v0.8.0` tag exists and no GitHub release was created.
A missed changelog roll silently became a missed release.

## Clarifications

Answered autonomously per `speckit-full`; each is recorded with its rationale in
[research.md](./research.md) and mirrored as an `[AUTO]` entry under Assumptions.

- Q: Fix the changelog, or relax the failing assertion? → A: fix the changelog [AUTO: the assertion caught a real
  process failure on its first true positive; weakening it deletes the only detection that exists]
- Q: Where does the guard live — `publish-release`, CI, a git hook, or a new subcommand? → A: a `publish-release`
  precondition [AUTO: it must refuse before the tag is created, and only a precondition can; CI is strictly too late]
- Q: What happens in a repository with no `CHANGELOG.md`? → A: the guard is skipped [AUTO: the CLI is published for use
  against arbitrary repositories, most of which keep no changelog]
- Q: Does the guard get an opt-out flag or config key? → A: no [AUTO: an opt-out is used in exactly the situation the
  guard exists for; the absent-file case is the legitimate skip and needs no switch]
- Q: How strictly is the heading matched? → A: exactly `## [X.Y.Z] - YYYY-MM-DD`, the pattern
  `tests/unit/changelog.test.ts` uses [AUTO: a looser match passes releases that the test then fails]

## User Scenarios & Testing *(mandatory)*

### User Story 1 - CI goes green again (Priority: P1)

A maintainer looking at the repository's CI sees every branch failing on a single changelog assertion. They need the
build restored so that unrelated work can merge and so that a release can be published at all.

**Why this priority**: every branch in the repository is red. Nothing else can be verified until this is fixed, and the
0.8.0 release is blocked behind it.

**Independent Test**: run `npm run test:unit -- tests/unit/changelog.test.ts` in a clone that has the repository's tags;
the suite passes.

**Acceptance Scenarios**:

1. **Given** the repository's tags include `0.8.0`, **When** the changelog structure test runs, **Then** it reports no
   released version without a section.
2. **Given** `CHANGELOG.md` after the fix, **When** the structure test runs, **Then** the `Unreleased`-first, dated,
   descending-order and known-category assertions still pass.
3. **Given** a reader opening `CHANGELOG.md`, **When** they look for what 0.8.0 shipped, **Then** they find a dated
   `## [0.8.0]` section describing the user-visible changes released on 2026-09-18.

---

### User Story 2 - A release refuses to start without its changelog section (Priority: P1)

A maintainer runs `automata git publish-release 0.9.0` from `develop` having forgotten to roll `Unreleased`. The command
refuses before it creates a branch, a merge or a tag, and tells them exactly what to do.

**Why this priority**: the missing section is the root cause of #80, not the symptom. Without the guard the same
omission re-breaks CI *and* silently skips the next release, and the only detection is a red build after the tag is
already pushed — at which point recovery requires moving a published tag.

**Independent Test**: in a scratch repository on `develop` with a clean tree and a `CHANGELOG.md` whose top released
section is not the version being released, run `automata git publish-release <version>`; the command exits non-zero and
no `release/<version>` branch or `<version>` tag exists afterwards.

**Acceptance Scenarios**:

1. **Given** `CHANGELOG.md` has no `## [0.9.0] - <date>` heading, **When** `automata git publish-release 0.9.0` runs,
   **Then** it writes an error naming the missing heading and the roll procedure, exits 1, and creates no branch, merge
   or tag.
2. **Given** `CHANGELOG.md` has a correctly formed `## [0.9.0] - 2026-10-01` heading, **When**
   `automata git publish-release 0.9.0` runs, **Then** the guard passes and the release sequence proceeds as before.
3. **Given** the same missing heading, **When** `automata git publish-release 0.9.0 --dry-run` runs, **Then** it refuses
   identically, so the dry run is a faithful rehearsal.
4. **Given** a repository with no `CHANGELOG.md` at all, **When** `publish-release` runs, **Then** the guard does not
   block the release.

---

### Edge Cases

- **`CHANGELOG.md` absent.** `automata` is a published CLI run against other repositories, most of which keep no
  changelog. The guard must not invent a requirement for them, so an unreadable or absent file passes.
- **The section exists but is undated or malformed** (`## [0.9.0]`, `## [0.9.0] - soon`). Treated as missing: the
  structural test would fail on it anyway, so accepting it would let the release proceed into the same red build.
- **The version appears somewhere other than a heading** — inside a bullet, in a link-reference footer
  (`[0.9.0]: https://…/compare/…`). Only a `## [X.Y.Z] - YYYY-MM-DD` heading counts.
- **`--dry-run`.** The guard is read-only, so it runs in both modes; a dry run that passes while a real run would refuse
  is worse than no dry run.
- **Ordering against the other preconditions.** The guard must run before the first ref is written, alongside the
  existing "tag already exists" and "trunk is behind" checks, so a refusal leaves the repository untouched.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `CHANGELOG.md` MUST contain a `## [0.8.0] - 2026-09-18` section, dated the day the `0.8.0` tag was
  created, holding the user-visible changes that were sitting under `Unreleased` at that commit.
- **FR-002**: `CHANGELOG.md` MUST retain an empty `## [Unreleased]` section above `0.8.0`, so subsequent work has a
  place to file bullets.
- **FR-003**: `automata git publish-release [version]` MUST refuse to run when the repository has a readable
  `CHANGELOG.md` that contains no `## [<version>] - YYYY-MM-DD` heading for the version being released.
- **FR-004**: The refusal message MUST name the exact heading expected and point at the documented roll procedure, and
  the command MUST exit with a non-zero status.
- **FR-005**: The check MUST run after the version is resolved and before any branch, merge, tag or push, so a refusal
  leaves the working tree and refs unchanged.
- **FR-006**: The check MUST run under `--dry-run` as well as a real run.
- **FR-007**: A repository with no `CHANGELOG.md`, or one that cannot be read, MUST NOT be blocked from releasing.
- **FR-008**: `docs/git.md` MUST document the new precondition on `automata git publish-release`, and
  `docs/maintenance.md` MUST record that the roll is now enforced rather than merely documented.

### Key Entities

- **Changelog section**: a `## [X.Y.Z] - YYYY-MM-DD` heading in `CHANGELOG.md`. The same shape
  `tests/unit/changelog.test.ts` already recognises; the gate and the test must agree on it or one will pass what the
  other rejects.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `npm run test:unit` passes in a clone carrying the repository's tags — the assertion that fails in run
  35383728708 reports zero undocumented versions.
- **SC-002**: A release attempted without its changelog section stops with a non-zero exit before the repository is
  modified: no `release/<version>` branch, no `<version>` tag, no merge commit, no push.
- **SC-003**: A release whose section is present behaves exactly as it does today — the existing `publish-release` tests
  continue to pass unchanged except for the new precondition.
- **SC-004**: `automata git publish-release --help` and `docs/git.md` both state the precondition, so a maintainer can
  learn it without triggering it.

## Assumptions

- [AUTO] **Scope of the CI fix**: only the missing `0.8.0` section is added; the structural test is not weakened.
  Rationale: the test is correct — it caught a real process failure, which is precisely what 035 built it for.
- [AUTO] **0.8.0 section content**: reconstructed from the bullets that stood under `## [Unreleased]` at tag `0.8.0`,
  not from commit subjects. Rationale: `docs/maintenance.md` states the roll is a rename of `Unreleased`, so the content
  released as 0.8.0 is by definition what was filed there.
- [AUTO] **0.8.0 section date**: `2026-09-18`, the commit date of the tagged merge. Rationale: `docs/maintenance.md`
  says to use "the date the release is cut".
- [AUTO] **Gate placement**: a precondition inside `publish-release`, not a separate `automata changelog check`
  subcommand and not a CI step. Rationale: it must refuse *before* the tag is created; a CI check only ever fires after
  the tag is pushed, which is the failure mode #80 already demonstrates.
- [AUTO] **Absent `CHANGELOG.md` passes**: the gate is skipped rather than failing closed. Rationale: `automata` is
  published for use against arbitrary repositories, and failing closed would make the command unusable for any project
  that keeps no changelog — a regression far larger than the problem being fixed.
- [AUTO] **Heading shape**: the gate reuses the exact `## [X.Y.Z] - YYYY-MM-DD` pattern from
  `tests/unit/changelog.test.ts`. Rationale: the gate exists to keep that test green; a looser pattern would pass
  releases the test then rejects.
- [AUTO] **No config key**: the gate is unconditional rather than switchable via `.automata/config.json`. Rationale:
  the project's own memory records that "a gate that blocks unrelated work gets disabled, not fixed" — but this gate
  blocks only a release that is genuinely undocumented, and the absent-file escape hatch already covers the legitimate
  case for skipping it. Adding a key would invite switching it off in exactly the situation it is for.
- **Out of scope**: republishing `0.8.0`. Restoring the release requires moving the published `0.8.0` tag to a commit
  that contains the fix, or cutting `0.8.1` — both are maintainer decisions with outward-facing consequences (npm,
  GitHub releases) and neither belongs in a pull request. Recorded in the pull request for the maintainer to action.
