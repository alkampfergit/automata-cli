# Feature Specification: A real, maintained CHANGELOG

**Feature Branch**: `feature/035-real-changelog`

**Created**: 2026-09-16

**Status**: Draft

**Input**: User description: "Rewrite CHANGELOG.md so it is a real, maintained changelog: document releases 0.2.0 through 0.6.0 (and keep 0.1.0), add an Unreleased section for the commits on develop since 0.6.0, and document the convention for keeping it up to date."

`CHANGELOG.md` has read `0.1.0 - Initial Release` since the first commit. Eight versions have been published since
(`0.2.0`, `0.2.1`, `0.2.2`, `0.3.0`, `0.4.0`, `0.5.0`, `0.6.0`), none of them recorded. Issue #71 asks for a stable
release; this feature makes the changelog true again first, so the `0.7.0` cut has something to append to.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Read what changed in a published version (Priority: P1)

A consumer of `automata-cli` — someone who installed `0.4.0` months ago and is deciding whether to upgrade — opens
`CHANGELOG.md` and finds one dated section per published version, describing in their own words what was added,
changed or fixed, newest first.

**Why this priority**: it is the whole of the request. Without it the file actively misinforms: it claims the project
is at `0.1.0`.

**Independent Test**: open `CHANGELOG.md` and check that every semver tag in the repository (`0.1.0` … `0.6.0`) has a
dated section whose content matches the commits that landed in that range.

**Acceptance Scenarios**:

1. **Given** the repository at this branch, **When** a reader opens `CHANGELOG.md`, **Then** they see sections for
   `0.6.0`, `0.5.0`, `0.4.0`, `0.3.0`, `0.2.2`, `0.2.1`, `0.2.0` and `0.1.0`, newest first, each with its release date.
2. **Given** a released version's section, **When** the reader compares it to `git log <previous-tag>..<tag>`, **Then**
   every user-visible change in that range is represented by at least one bullet.
3. **Given** a version section, **When** the reader looks for a bullet's origin, **Then** the bullet describes the
   behaviour change, not the commit subject or the file touched.

---

### User Story 2 - See what is waiting for the next release (Priority: P2)

Someone about to run `automata git publish-release` wants to know what the next tag will contain. They read the
`Unreleased` section at the top of `CHANGELOG.md` and find the work merged into `develop` since `0.6.0`.

**Why this priority**: it is what turns the file from an archive into something used at release time, and it is the
section the `0.7.0` cut asked for in issue #71 will rename.

**Independent Test**: compare the `Unreleased` bullets against `git log 0.6.0..develop` — every user-visible change is
there and nothing already released is.

**Acceptance Scenarios**:

1. **Given** the repository at this branch, **When** a reader opens `CHANGELOG.md`, **Then** `## [Unreleased]` is the
   first section, above every version section.
2. **Given** the `Unreleased` section, **When** a release is cut, **Then** the documented procedure says to rename that
   heading to the new version with its date and open a fresh empty `Unreleased`.

---

### User Story 3 - Know where to record a change, and keep the file from rotting again (Priority: P3)

A contributor (human or agent) finishing a feature branch knows, without asking, that a user-visible change gets a
bullet under `Unreleased`, which category it goes in, and what happens to it at release time. A structural test fails
if the file's shape is broken.

**Why this priority**: the file drifted for eight releases precisely because no written rule said who updates it and
when. Recording the history without recording the convention buys a few months at most.

**Independent Test**: a contributor who has read only `AGENTS.md` and `docs/maintenance.md` can state where a bullet
goes and what the release step does with it; `npm test` fails if `CHANGELOG.md`'s structure regresses.

**Acceptance Scenarios**:

1. **Given** `docs/maintenance.md`, **When** a contributor looks for the changelog rule, **Then** they find the format,
   the categories, the release-time procedure and the relationship to the auto-generated GitHub release notes.
2. **Given** `AGENTS.md`'s working defaults, **When** an agent finishes a user-visible change, **Then** it is told to
   add an `Unreleased` bullet.
3. **Given** a `CHANGELOG.md` whose version headings are out of order, undated, or malformed, **When** `npm test` runs,
   **Then** it fails naming the offending heading.
4. **Given** a semver tag with no matching section, **When** `npm test` runs, **Then** it fails naming the missing
   version.

---

### Edge Cases

- **Both `0.6.0` and `v0.6.0` tags exist** (the `v`-prefixed one is created by the GitHub release job). The structural
  check must treat them as the same version rather than demanding two sections.
- **Shallow clone with no tags fetched.** The tag-coverage check cannot run; it must say so rather than pass silently
  on an empty tag list or fail a legitimate clone.
- **Prerelease versions published to npm** (`0.7.0-develop.123`, `…-next.N`) exist as dist-tags, never as git tags, and
  are not releases. They get no changelog section.
- **A patch release that only changed packaging** (`0.2.1` readme, `0.2.2` attestation) still gets a section, however
  short — a missing version reads as a lost release.
- **`package.json` stays at `0.1.0`.** The published version is derived from the git tag by CI, so the changelog's
  version headings must come from tags, and nothing may assert that the two agree.

## Clarifications

### Session 2026-09-16 (autonomous)

- Q: Per-commit or per-change bullets for the reconstructed releases? → A: per user-visible change, merging a spec-kit run's fix-up commits into one bullet [AUTO: the GitHub release notes are already auto-generated per commit, so a second per-commit list would be redundant; the changelog's value is the human summary].
- Q: What should the structural test do when git tags are unavailable (shallow clone)? → A: report that the coverage check could not run, and still assert the format invariants [AUTO: failing a legitimate shallow clone would make the suite environment-dependent; passing silently on an empty tag list would be vacuous — the format assertions are unconditional either way].
- Q: Should `automata git publish-release` roll `Unreleased` into the new version heading automatically? → A: no, manual for now, recorded as a follow-up [AUTO: issue #71 asked to modify the changelog, not to change the release command; automating it needs its own precondition, dry-run output and failure mode].
- Q: Where does the convention live, given `AGENTS.md` says subcommand detail belongs in `docs/`? → A: `docs/maintenance.md`, which already holds non-command-group policy (audit gate, Dependabot scope, deferred upgrades) [AUTO: the changelog is release policy, not a command group; `docs/git.md` and `AGENTS.md` link to it rather than restating it].
- Q: Should the `Unreleased` section mention the Dependabot scope change (#68)? → A: yes, under `Changed` [AUTO: it alters what contributors see in the repository — no more weekly version-update PRs — which is observable, unlike an internal refactor].

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `CHANGELOG.md` MUST contain one section per published semver git tag: `0.1.0`, `0.2.0`, `0.2.1`, `0.2.2`,
  `0.3.0`, `0.4.0`, `0.5.0`, `0.6.0`.
- **FR-002**: Version sections MUST appear newest first and carry the release date of the tag in `YYYY-MM-DD` form.
- **FR-003**: `CHANGELOG.md` MUST open with an `Unreleased` section listing the user-visible work merged into
  `develop` since `0.6.0`.
- **FR-004**: Bullets MUST be grouped under the Keep a Changelog categories (`Added`, `Changed`, `Fixed`, `Removed`,
  `Security`), and MUST describe behaviour in the reader's terms rather than restating commit subjects.
- **FR-005**: Bullets MUST NOT be generated for spec-kit bookkeeping commits (`docs: initialise PR artifacts`,
  `docs: finalise PR artifacts`, `docs: refresh speckit memory`) — they change nothing a user can observe.
- **FR-006**: `docs/maintenance.md` MUST document the changelog convention: format, categories, when a bullet is added,
  what the release step does to `Unreleased`, and why the file exists alongside auto-generated GitHub release notes.
- **FR-007**: `docs/git.md`'s `publish-release` section MUST point at that convention, since that command is what cuts
  a release.
- **FR-008**: `AGENTS.md` working defaults MUST tell a contributor to add an `Unreleased` bullet for a user-visible
  change.
- **FR-009**: A unit test MUST fail when `CHANGELOG.md`'s structure regresses: a missing or non-leading `Unreleased`
  section, a malformed or undated version heading, versions out of descending order, or a released tag with no section.
- **FR-010**: The tag-coverage assertion MUST tolerate a repository whose tags are unavailable (shallow clone) by
  reporting that it could not check, and MUST treat `X.Y.Z` and `vX.Y.Z` as one version.

### Key Entities

- **Changelog entry**: one released version — a semver number, a release date, and bullets grouped by category.
- **Unreleased section**: the same shape without a version or date; the accumulator a release renames.
- **Semver tag**: the authority for which versions exist and when they were released. `package.json`'s `version` field
  is not.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All 8 published versions have a section; 0 published versions are missing.
- **SC-002**: A reader can answer "what changed between 0.4.0 and 0.5.0?" from `CHANGELOG.md` alone, without opening
  git history or the GitHub releases page.
- **SC-003**: Every commit in `0.6.0..develop` that changes observable behaviour is represented in `Unreleased`;
  bookkeeping commits are not.
- **SC-004**: `npm test && npm run lint` pass, and deliberately breaking a heading in `CHANGELOG.md` makes the new test
  fail.
- **SC-005**: The changelog convention is stated in exactly one authoritative place (`docs/maintenance.md`), referenced
  from the two places a contributor meets it (`AGENTS.md`, `docs/git.md`).

## Assumptions

- [AUTO] Format: chose **Keep a Changelog 1.1.0** headings (`## [X.Y.Z] - YYYY-MM-DD`, category sub-headings) because
  it is the de-facto standard for npm packages, is machine-checkable, and the existing file's `## [0.1.0] - Initial
  Release` heading is already half-way there.
- [AUTO] History source: reconstructed from `git log <prev-tag>..<tag>` for each tag, with the release date taken from
  the tag's own date, because no other record of these releases exists.
- [AUTO] Granularity: one bullet per user-visible change, merging the multi-commit spec-kit runs (`feat(032): …` plus
  its fixes) into a single bullet, because a per-commit list would reproduce the auto-generated GitHub release notes
  that already exist and add nothing.
- [AUTO] Scope of "user-visible": CLI commands, flags, config keys, output and packaging. Dependency refreshes appear
  only when they change what a consumer must do (the Node 22.12 floor); internal refactors and spec-kit artifacts do
  not appear.
- [AUTO] Release-time mechanics stay manual: `automata git publish-release` is **not** taught to rewrite the file in
  this feature. Out of scope for "modify the changelog", and it would need its own precondition and failure mode. It is
  recorded as a follow-up instead.
- [AUTO] `CHANGELOG.md` is not added to `package.json`'s `files` whitelist, so it stays a repository document and the
  published tarball is unchanged. Changing what ships is a packaging decision, not part of this request.
- [AUTO] `README.md` is untouched: per `AGENTS.md` the README covers installation, quick start, the command-group table
  and dev setup, none of which change here.
- [AUTO] The `0.2.1`/`0.2.2` sections are short (readme, attestation) because that is genuinely all those releases
  contained; a short section is preferred to omitting the version.
