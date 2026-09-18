# Feature Specification: Release Trunk Detection

**Feature Branch**: `feature/036-release-trunk-detection`

**Created**: 2026-09-18

**Status**: Draft

**Input**: User description: "Resolve the release trunk branch from the remote instead of hardcoding master, fetch tags before version inference, and support a develop-only clone. Issue #76."

## Clarifications

### Session 2026-09-18

Every question below was settled on issue #76 before implementation started; the answers are recorded
here so the spec stands alone.

- Q: Should the trunk name be detected or configured? → A: Detected by default, with an optional
  config override that wins when set. [Locked on issue #76]
- Q: Should `--dry-run` perform the fetch? → A: Yes. The fetch is read-only and it is what makes the
  previewed version match a real run. [Locked on issue #76]
- Q: Should `--dry-run` create the local trunk branch? → A: No. Branch creation only happens on a real
  publish. [Locked on issue #76]
- Q: A local trunk behind `origin/<trunk>` — fast-forward or refuse? → A: Refuse with an explicit
  message; the branch may carry the maintainer's work. [Locked on issue #76]
- Q: Where does version inference read from? → A: The remote-tracking ref `origin/<trunk>`, so a
  develop-only clone never needs a local trunk branch. [Locked on issue #76]

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Publish a release from a develop-only clone (Priority: P1)

A maintainer clones the repository, ends up with only `develop` checked out, and runs
`automata git publish-release`. Today the command fails with "No semver tag found on master" because
version inference asks `git describe` about a local `master` ref that the clone never created. The
maintainer wants the command to work out which branch the remote calls its trunk, bring its tags down,
and infer the version from it — without having to check anything out by hand first.

**Why this priority**: It is the reported defect (#76) and it makes `publish-release` unusable on a
fresh clone. Everything else in this feature exists to serve it.

**Independent Test**: Run `automata git publish-release --dry-run` in a clone that has only `develop`
locally and a semver tag on the remote trunk; the command must print the inferred version and the
release sequence instead of erroring.

**Acceptance Scenarios**:

1. **Given** a clone with only a local `develop` branch and a remote whose trunk is `master` carrying
   tag `0.7.0`, **When** the maintainer runs `automata git publish-release --dry-run`, **Then** the
   command reports the detected trunk, fetches tags, and announces version `0.7.0 → 0.8.0`.
2. **Given** the same clone, **When** the maintainer runs `automata git publish-release` for real,
   **Then** the local trunk branch is created from `origin/<trunk>` as part of the release
   sequence and the final push names the detected trunk.
3. **Given** a repository whose trunk is named `main`, **When** the maintainer runs
   `automata git publish-release`, **Then** every step that previously said `master` says `main`.

---

### User Story 2 - Version inference sees every tag the remote has (Priority: P2)

A maintainer whose local clone has not fetched for a while runs `automata git publish-release`.
Version inference must not derive the next version from a stale local tag list, because that would
produce a version that already exists on the remote.

**Why this priority**: It is a correctness requirement for the auto-detected version, but the command
is at least usable without it.

**Independent Test**: Run the command in a clone whose tags are behind the remote and observe that a
tag fetch happens before the version is announced.

**Acceptance Scenarios**:

1. **Given** a clone missing the remote's newest tag, **When** the maintainer runs
   `automata git publish-release`, **Then** tags are fetched from `origin` before the version is
   inferred and the newest remote tag is the one used.
2. **Given** `--dry-run`, **When** the maintainer runs the command, **Then** the fetch still happens,
   so the previewed version matches what a real run would produce.
3. **Given** a machine that cannot reach `origin`, **When** the maintainer runs the command, **Then**
   it stops with the fetch failure rather than continuing on possibly stale data.

---

### User Story 3 - Override the detected trunk name (Priority: P3)

A maintainer whose repository uses a trunk name that detection cannot infer (or who wants to pin it)
records the name once in `.automata/config.json` and never thinks about it again.

**Why this priority**: Detection covers the normal cases; the override is the escape hatch for the
rest, and the feature is useful without it.

**Independent Test**: Set the config key to a branch name, run `--dry-run`, and observe that the
configured name is used and no detection commands run.

**Acceptance Scenarios**:

1. **Given** the trunk branch key is set in `.automata/config.json`, **When** the maintainer runs
   `automata git publish-release`, **Then** the configured name is used and detection is skipped.
2. **Given** the key is absent or blank, **When** the maintainer runs the command, **Then** the trunk
   name is detected from the remote.

---

### Edge Cases

- **Trunk cannot be resolved at all**: the command stops before touching the repository and lists
  every candidate it tried, plus the config key that would settle it.
- **A local trunk branch exists but is behind the remote**: the command refuses with an explicit
  message naming the branch and how far behind it is, rather than silently moving a branch that may
  carry the maintainer's work.
- **A local trunk branch exists and is up to date or ahead**: the release sequence uses it as-is; no
  branch is created.
- **The remote is unreachable**: the fetch fails and the command stops with that failure.
- **The trunk has no semver tag**: the existing "pass a version explicitly" error is kept, but it
  names the detected trunk instead of `master`.
- **An explicit version argument is given**: trunk resolution and the fetch still happen, because the
  checkout, tag and push steps need the trunk name regardless of where the version came from.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `publish-release` MUST determine the trunk branch name rather than assuming `master`.
- **FR-002**: Resolution MUST try, in order: the configured override; the remote's recorded HEAD
  (`origin/HEAD`); the remote's advertised HEAD symref; then the candidates `main` and `master`
  probed against the remote.
- **FR-003**: When no candidate resolves, the command MUST exit with code 1 before performing any git
  operation, naming every candidate it tried and the config key that overrides detection.
- **FR-004**: The command MUST fetch tags and the trunk ref from `origin` before inferring a version,
  and MUST do so in `--dry-run` as well.
- **FR-005**: A failed fetch MUST stop the command with code 1.
- **FR-006**: Version inference MUST read the remote-tracking trunk ref, so no local trunk branch is
  required.
- **FR-007**: The "no semver tag" error MUST name the resolved trunk ref rather than `master`.
- **FR-008**: When a local trunk branch exists and is behind the remote trunk, the command MUST refuse
  with an explicit message and MUST NOT fast-forward, merge or reset it.
- **FR-009**: When no local trunk branch exists, the real release sequence MUST create it *from*
  `origin/<trunk>`. It MUST NOT be required to configure an upstream: git refuses to set tracking
  information from a ref a `--single-branch` clone's refspec does not cover, which is the very clone
  shape this feature exists for. `--dry-run` MUST print that step without creating anything.
- **FR-010**: The checkout, merge, tag and push steps MUST use the resolved trunk name, including the
  final `git push origin develop <trunk> <version>`.
- **FR-011**: The resolved trunk name and how it was resolved MUST be reported on stdout before the
  release sequence runs.
- **FR-012**: A configuration key MUST let a repository pin the trunk name; it MUST be unset by
  default, settable through both `automata config set` and the configuration wizard, and clearable
  through the wizard by leaving the field blank.
- **FR-013**: `--dry-run` MUST NOT run any mutating git command — no checkout, branch creation, merge,
  tag, or push.

### Key Entities

- **Trunk resolution**: the branch name the remote treats as its trunk, plus the source that produced
  it (`config`, `origin/HEAD`, `ls-remote`, or `probe`), used for reporting.
- **Release plan**: the version, the resolved trunk name and the dry-run flag that together describe
  the sequence of git operations to run.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `automata git publish-release --dry-run` succeeds in a clone that has only `develop`
  locally, for a remote trunk named either `main` or `master`.
- **SC-002**: The string `master` appears in no code path of the release sequence except as one of
  the probed candidates.
- **SC-003**: A dry run performs zero mutating git operations, proven by a test that asserts every
  mutating command is absent.
- **SC-004**: Every failure mode above (unresolvable trunk, failed fetch, behind local trunk, no
  semver tag) exits with code 1 and a message naming the branch involved.

## Assumptions

- [AUTO] Remote name: assumed to be `origin`, because every other git operation in
  `src/git/gitService.ts` hardcodes it and making it configurable is outside the reported defect.
- [AUTO] Base branch: `publish-release` keeps requiring `develop` as the current branch and keeps
  naming `develop` in its merge-back and push steps; only the trunk side is detected. Generalising
  the develop side is a separate change and was not requested.
- [AUTO] Fetch failure is fatal: a command whose last step is `git push origin …` cannot succeed
  without the remote, so continuing after a failed fetch could only produce a version derived from
  stale tags.
- [AUTO] Config override is trusted without a remote round-trip: it is an explicit statement by the
  repository owner, and a wrong value fails loudly at the fetch step with git's own message.
- [AUTO] Config placement: the override is a new top-level `git` section rather than an entry under
  `doWork`, because `publish-release` is not a `do-work` turn and `doWork.*` keys are documented as
  settings for the unattended loop.
- [AUTO] "Behind" is measured as commits present on the remote trunk and absent locally; a local
  trunk that is ahead or has diverged is not refused, because the merge and push steps will surface
  that with git's own error.
