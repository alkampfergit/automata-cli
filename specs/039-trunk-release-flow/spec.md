# Feature Specification: Trunk-based release flow

**Feature Branch**: `feature/039-trunk-release-flow`

**Created**: 2026-09-26

**Status**: Draft

**Input**: Issue #84 — "When we ask to create a new release, automata works only if we use gitflow, but doesn't work
with trunk based development when we have only main or master". Design agreed on the issue thread: a
`git.releaseFlow: "gitflow" | "trunk"` config key, detected from `origin/develop` when unset; the trunk flow creates an
empty release commit on the trunk, tags it, and pushes branch and tag in one atomic push.

## Context

`automata git publish-release` is GitFlow-only. Spec 036 made the *trunk* branch configurable (`git.trunkBranch`,
otherwise detected from `origin`), but `develop` is still literal in `src/git/gitService.ts`:

- `checkReleasePreconditions()` refuses unless the current branch is `develop`;
- `publishRelease()` always creates `release/<version>`, merges it into the trunk and back into `develop`, then pushes
  `origin develop <trunk> <version>`.

A repository that only has `main` or `master` fails at the first check and cannot release at all.

The release pipeline this command feeds is the branch-push CI of `.github/workflows/ci.yml`: the `publish` job runs on a
push to `master`, reads `git tag --points-at HEAD`, and the `release` job creates the GitHub release. Two constraints
follow, both raised on the issue:

1. The tag must reach `origin` **in the same push** as the trunk commit it points at. A commit pushed before its tag
   makes `publish` fail with "No version tag found on HEAD", and a later tag-only push triggers no workflow.
2. The trunk ref must **move** in that push, or no push event fires. GitFlow guarantees this implicitly, because
   `git merge --no-ff release/<version>` always creates a new commit. The trunk flow needs its own guarantee: an empty
   release commit.

## Clarifications

### Session 2026-09-26

- Q: How is the flow chosen — a flag, a config key, or detection? → A: config key `git.releaseFlow`, detected from
  `origin/develop` when unset; no new flag [agreed on issue #84]
- Q: Does the trunk flow bump `package.json` or create a GitHub release? → A: neither; it only commits, tags and
  pushes, and the GitHub release stays with CI [agreed on issue #84]
- Q: How does the trunk push trigger CI? → A: one `git push --atomic origin <trunk> <version>` after an empty
  `chore(release): <version>` commit, so the ref always moves and the tag always arrives with it [agreed on issue #84]
- Q: What happens when the `origin/develop` probe itself fails (network, bad remote)? → A: the command refuses with the
  probe's error rather than guessing a flow [AUTO: a transient failure must not silently select a different release
  procedure; the fetch a few steps later would fail against the same remote anyway]
- Q: Is a trunk that is *ahead* of `origin/<trunk>` allowed? → A: yes — ahead is allowed (e.g. an unpushed changelog
  roll), behind or diverged is refused [agreed on issue #84]

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Release from a trunk-only repository (Priority: P1)

A maintainer of a repository that only has `main` rolls `CHANGELOG.md`, commits it on `main`, and runs
`automata git publish-release`. The command detects the trunk flow, creates an empty `chore(release): <version>`
commit, tags it, and pushes `main` and the tag together, so the branch-push CI publishes the release.

**Why this priority**: this is the whole of issue #84 — today the command cannot be used at all in such a repository.

**Independent Test**: in a scratch repository whose `origin` has only `main` (tagged `1.2.0`), on `main` with a clean
tree, run `automata git publish-release`; afterwards `origin/main` points at a new empty commit carrying tag `1.3.0`,
and no `release/*` or `develop` branch exists.

**Acceptance Scenarios**:

1. **Given** `origin` has no `develop` branch and `git.releaseFlow` is unset, **When** `publish-release` runs,
   **Then** it prints `Release flow: trunk (detected: origin/develop does not exist)` and runs, in order,
   `git commit --allow-empty -m "chore(release): <version>"`, `git tag <version>`,
   `git push --atomic origin <trunk> <version>`.
2. **Given** the trunk flow, **When** the command runs from any branch other than the trunk, **Then** it exits 1 with
   an error naming the trunk and the current branch, and nothing is committed, tagged or pushed.
3. **Given** the trunk flow and a local trunk behind `origin/<trunk>`, **When** the command runs, **Then** it exits 1
   before committing.
4. **Given** the trunk flow and a local trunk *ahead* of `origin/<trunk>` (an unpushed changelog roll), **When** the
   command runs, **Then** it proceeds and the unpushed commits are pushed with the release commit.
5. **Given** the trunk flow with `--dry-run`, **When** the command runs, **Then** it prints the flow line and the three
   commands exactly as a real run would execute them, and executes none of them.

---

### User Story 2 - GitFlow repositories are unaffected (Priority: P1)

A maintainer of a GitFlow repository (this one) runs `publish-release` from `develop` exactly as before.

**Why this priority**: the existing flow is what ships this project; a regression would stop its own releases.

**Independent Test**: the existing `publish-release` tests pass unchanged, with the addition of the flow line.

**Acceptance Scenarios**:

1. **Given** `origin/develop` exists and `git.releaseFlow` is unset, **When** `publish-release` runs, **Then** it
   prints `Release flow: gitflow (detected: origin/develop exists)` and runs the unchanged GitFlow sequence.
2. **Given** the gitflow flow, **When** the command runs from a branch other than `develop`, **Then** it refuses with
   the existing message.

---

### User Story 3 - Pin the flow explicitly (Priority: P2)

A maintainer whose repository keeps a `develop` branch for another reason but releases trunk-based sets
`git.releaseFlow` to `trunk` (by `automata config set git-release-flow trunk` or the wizard), and detection is skipped.

**Why this priority**: detection is a heuristic; the escape hatch is required, but most repositories never need it.

**Independent Test**: with `git.releaseFlow: "trunk"` and an `origin/develop` present, `publish-release --dry-run`
prints `Release flow: trunk (configured as git.releaseFlow)` and does not probe `origin/develop`.

**Acceptance Scenarios**:

1. **Given** `git.releaseFlow` is `"trunk"` or `"gitflow"`, **When** `publish-release` runs, **Then** that flow is used
   and `origin/develop` is not probed.
2. **Given** `.automata/config.json` holds any other `git.releaseFlow` value, **When** `publish-release` runs,
   **Then** it exits 1 naming the invalid value and the accepted ones.
3. **Given** `automata config set git-release-flow <value>`, **When** the value is not `gitflow` or `trunk`, **Then**
   it exits 1 and writes nothing.
4. **Given** the configuration wizard, **When** the maintainer opens `Git`, **Then** after the trunk branch screen a
   release flow screen offers "Detect from origin", "GitFlow" and "Trunk-based"; "Detect" clears the key.

---

### Edge Cases

- **Branch already pushed.** The empty release commit is created on every trunk-flow release, so the push always moves
  the trunk ref and CI always fires — even when the changelog roll was already pushed.
- **Push rejected** (someone pushed to the trunk meanwhile). `--atomic` means neither the trunk nor the tag lands on
  `origin`; the local release commit and tag remain and the error names the failed command. Recovery is documented.
- **The `origin/develop` probe fails** for a reason other than "not found" (git exit code ≠ 0 and ≠ 2). Refused with
  git's stderr; no flow is guessed.
- **Invalid hand-edited `git.releaseFlow`.** Refused, not ignored — silently detecting instead would run a procedure
  the operator explicitly opted out of.
- **`--dry-run`.** Detection, fetch and every precondition are read-only and run in both modes; the commit, tag and
  push do not.
- **Changelog gate, tag-exists check, version auto-detection.** Unchanged and shared by both flows.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `publish-release` MUST resolve a release flow, `gitflow` or `trunk`, before any precondition that depends
  on it: from `git.releaseFlow` when set, otherwise `gitflow` when `origin` has a `develop` branch and `trunk` when it
  does not.
- **FR-002**: The command MUST print `Release flow: <flow> (<source>)` on stdout, next to the existing
  `Trunk branch:` line, in real and dry runs.
- **FR-003**: A `git.releaseFlow` value other than `gitflow` or `trunk`, or a failed `origin/develop` probe, MUST make
  the command exit 1 with a message on stderr before any ref is written.
- **FR-004**: In the gitflow flow the command's behaviour MUST be unchanged.
- **FR-005**: In the trunk flow the command MUST require the current branch to be the resolved trunk branch and the
  working tree to be clean.
- **FR-006**: In the trunk flow the command MUST refuse when the local trunk is behind `origin/<trunk>` and MUST allow
  it to be ahead.
- **FR-007**: In the trunk flow, after all preconditions pass, the command MUST run exactly
  `git commit --allow-empty -m "chore(release): <version>"`, `git tag <version>` and
  `git push --atomic origin <trunk> <version>`, in that order, and MUST NOT create a release branch, merge, touch
  `develop` or modify `package.json`.
- **FR-008**: Version auto-detection, the tag-exists check, the changelog gate and `--dry-run` MUST behave identically
  in both flows.
- **FR-009**: `automata config set git-release-flow <gitflow|trunk>` MUST write `git.releaseFlow`, rejecting any other
  value; the wizard's `Git` section MUST offer the same choice plus "detect", which clears the key.
- **FR-010**: `docs/git.md`, `docs/config.md` and `CHANGELOG.md` MUST document the flow, its detection, the trunk
  sequence and the CI expectation (publishing from the trunk-branch push when a version tag is on `HEAD`).

### Key Entities

- **Release flow**: `gitflow` | `trunk`, plus its source (`config` or detection, and what detection saw).
- **Release plan**: the ordered list of git commands a flow executes; the same list is printed by `--dry-run`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a repository whose `origin` has only a trunk branch, one `publish-release` invocation leaves
  `origin/<trunk>` on a new commit carrying the version tag, with no other branch created.
- **SC-002**: Every existing `publish-release` test passes; the only change to their expectations is the added flow line.
- **SC-003**: A trunk-flow dry run executes no `commit`, `tag <version>` or `push`.
- **SC-004**: `publish-release --help`, `docs/git.md` and `docs/config.md` describe both flows and how the flow is
  chosen.

## Assumptions

- [AUTO] **Detection probe**: `git ls-remote --exit-code --heads origin develop`, reading exit 0 as present and 2 as
  absent. Because it asks the remote directly, it works in a `--single-branch` clone, which has no
  `refs/remotes/origin/develop` (036 lesson).
- [AUTO] **Probe failure refuses**: any other exit code stops the command. A transient network failure must not select
  a different release procedure.
- [AUTO] **Release commit message**: `chore(release): <version>`, matching the repository's conventional-commit
  subjects and the wording agreed on the issue.
- [AUTO] **No recovery automation**: when the atomic push is rejected, the command does not undo the local commit and
  tag. It reports the failed command, and `docs/git.md` documents the two-command recovery. This matches the gitflow
  flow, which leaves its local state in place on failure too.
- [AUTO] **Setter cannot clear**: `config set git-release-flow` accepts only `gitflow` or `trunk`, like
  `git-trunk-branch`, which cannot clear its key either. Clearing is done through the wizard's "Detect" option or by
  editing the file.
- [AUTO] **Wizard placement**: the release flow screen follows the trunk branch screen inside the existing `Git` entry,
  rather than adding a new main-menu entry. The main-menu navigation tests count positions, and both keys configure
  the same command.
- The changelog roll is committed on the trunk *before* the command runs, the same as it is on `develop` today; the
  gate enforces it.
- Other repositories need CI that publishes from the trunk-branch push when a version tag is on `HEAD`, which is how
  this repository's CI already works. automata cannot configure that for them.
