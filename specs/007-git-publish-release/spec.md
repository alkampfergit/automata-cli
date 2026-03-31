# Feature Specification: Git Publish Release

**Feature Branch**: `007-git-publish-release`
**Created**: 2026-03-31
**Status**: Draft
**Input**: User description: "git publish-release: will use git command to simulate a new release and immediately close, it will accept optionally a version number, if no version number is given simply get the actual tag on master and increment the middle number. After the release is closed locally push develop master and the new tag."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Publish Release with Auto-Versioning (Priority: P1)

A developer on the `develop` branch wants to cut a new release without manually deciding the version number. Running `automata git publish-release` detects the latest tag on `master`, increments the minor version segment, runs the full GitFlow release sequence, and pushes `develop`, `master`, and the new tag to `origin`.

**Why this priority**: This is the primary usage path — the auto-versioning case eliminates manual error and covers the majority of release workflows.

**Independent Test**: Can be fully tested by running `automata git publish-release` in a repo with a semver tag on `master` and verifying the correct minor-bumped tag, updated `master`, and updated `develop` are pushed to `origin`.

**Acceptance Scenarios**:

1. **Given** the latest tag on `master` is `1.2.0`, **When** the user runs `automata git publish-release`, **Then** the command creates a `release/1.3.0` branch, merges it into `master` (tagged `1.3.0`), merges it back into `develop`, deletes the release branch, and pushes `develop`, `master`, and tag `1.3.0`.
2. **Given** `master` has no tags at all, **When** the user runs `automata git publish-release`, **Then** the command aborts with a clear error message explaining that no version tag was found and a version must be provided explicitly.
3. **Given** the latest tag on `master` is `2.0.5`, **When** the user runs `automata git publish-release`, **Then** the resulting version is `2.1.0` (middle segment incremented, patch reset to 0).

---

### User Story 2 - Publish Release with Explicit Version (Priority: P2)

A developer wants to release a specific version (e.g., for a major bump or pre-planned milestone) and passes the version number directly.

**Why this priority**: Explicit version control is required for non-sequential releases such as major bumps.

**Independent Test**: Can be fully tested by running `automata git publish-release 3.0.0` and verifying that `release/3.0.0` is created, merged to `master`, tagged `3.0.0`, merged back to `develop`, and all are pushed.

**Acceptance Scenarios**:

1. **Given** the user runs `automata git publish-release 3.0.0`, **Then** the command creates `release/3.0.0`, merges it into `master` (tagged `3.0.0`), merges it back into `develop`, deletes the release branch, and pushes `develop`, `master`, and tag `3.0.0`.
2. **Given** the user passes an invalid version string like `automata git publish-release notaversion`, **When** the command runs, **Then** it aborts with an error indicating the version must follow semver format (`X.Y.Z`).
3. **Given** a tag with the provided version already exists, **When** the user runs `automata git publish-release 1.2.0`, **Then** the command aborts with an error that the tag `1.2.0` already exists.

---

### Edge Cases

- What happens when the working tree has uncommitted changes?
- What happens when the `master` branch does not exist locally?
- What happens when the `develop` branch does not exist locally?
- What happens when the user is not currently on the `develop` branch?
- What happens when `git push` fails (e.g., no remote configured, network error)?
- What happens when the merge from the release branch into `master` or `develop` produces a conflict?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The CLI MUST expose a `publish-release` subcommand under the `automata git` command group.
- **FR-002**: The command MUST accept an optional positional argument `[version]` in `X.Y.Z` semver format.
- **FR-003**: When no version is provided, the command MUST detect the most recent semver tag reachable from `master` and produce a new version by incrementing the middle (minor) segment and resetting the patch segment to `0`.
- **FR-004**: When no version is provided and no semver tag exists on `master`, the command MUST abort with a clear error message instructing the user to pass a version explicitly.
- **FR-005**: When a version is provided, the command MUST validate that it matches the `X.Y.Z` semver pattern; invalid input MUST cause an early abort with a descriptive error to stderr.
- **FR-006**: The command MUST abort if a git tag with the target version already exists.
- **FR-007**: The command MUST abort with a non-zero exit code and a descriptive error if there are uncommitted changes in the working tree.
- **FR-008**: The command MUST abort with a descriptive error if the current branch is not `develop`.
- **FR-009**: The command MUST execute the following GitFlow release sequence in order:
  1. Create `release/<version>` branch from current `develop`
  2. Checkout `master` and merge `release/<version>` with `--no-ff`
  3. Tag `master` with `<version>`
  4. Checkout `develop` and merge `release/<version>` with `--no-ff`
  5. Delete the local `release/<version>` branch
  6. Push `develop`, `master`, and `<version>` tag to `origin`
- **FR-010**: The command MUST abort and provide a clear error message if any git operation in the sequence fails (e.g., merge conflict, push failure).
- **FR-011**: The command MUST output the version being released and a success confirmation to stdout upon completion.
- **FR-012**: The command MUST output errors to stderr and exit with a non-zero code on any failure.
- **FR-013**: The command MUST support a `--dry-run` flag that prints each git command that would be executed without running them.

### Key Entities

- **Release Version**: A semver string `X.Y.Z` identifying the release. Derived from the latest `master` tag (auto-bump) or provided by the user.
- **Release Branch**: A short-lived `release/<version>` git branch created from `develop` and deleted after merging into both `master` and `develop`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can cut and close a full GitFlow release (including remote push) with a single command in under 30 seconds under normal network conditions.
- **SC-002**: The auto-versioning logic correctly increments the minor segment for all valid semver tags encountered (patch resets to 0).
- **SC-003**: All invalid inputs (bad semver, existing tag, wrong branch, dirty working tree) are rejected before any git state is modified.
- **SC-004**: The `--dry-run` flag allows developers to preview all git operations without modifying local or remote state.

## Assumptions

- [AUTO] Remote name: chose `origin` because it is the universal default remote name and matches all existing commands in this codebase.
- [AUTO] Merge strategy: chose `--no-ff` for both master and develop merges to preserve GitFlow history, consistent with GitFlow convention.
- [AUTO] No version-file update: chose to skip updating `package.json` version because the feature description specifies git operations only; version file updates are a separate concern.
- [AUTO] Branch source: release branch is always created from `develop`, the canonical GitFlow source branch.
- [AUTO] `--json` flag: omitted because this command performs side-effecting git operations; a structured output flag adds complexity without a clear consumer. `--dry-run` serves the inspection use case instead.
