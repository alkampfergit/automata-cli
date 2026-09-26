# Phase 0 Research: Trunk-based release flow

**Feature**: `feature/039-trunk-release-flow` | **Date**: 2026-09-26

The git behaviour below was checked on throwaway repositories: a bare `origin` with only `master`, a full clone, and a
`git clone --single-branch --branch master` clone. None of it is assumed.

## Verified git behaviour

| Probe | Result |
|---|---|
| `git ls-remote --exit-code --heads origin develop` on a remote with no `develop` | no output, **exit 2** |
| the same against a non-existent remote | **exit 128** |
| `git commit --allow-empty -m "chore(release): 1.0.0"` + `git tag 1.0.0` + `git push --atomic origin master 1.0.0` in the single-branch clone | exit 0; `origin` gets `refs/heads/master` and `refs/tags/1.0.0` on the same new commit |
| the same push from a clone that is behind `origin/master` | exit 1; **both** refs rejected (`1.1.0 -> 1.1.0 (atomic push failed)`), and the tag does not reach `origin` |

## Decisions

### D-001 — Flow detection: `ls-remote --exit-code --heads origin develop`, three outcomes

**Decision**: With `git.releaseFlow` unset, exit 0 → `gitflow` and exit 2 → `trunk`. Any other exit code is a
refusal that carries git's stderr.

**Rationale**: The probe asks the remote directly, so it gives the same answer in a `--single-branch` clone, which never
has `refs/remotes/origin/develop`. The existing `remoteBranchExists()` collapses every non-zero exit into "absent". It
cannot be reused here, because it would read a network failure as "trunk" and run a different release procedure than
the operator expects.

**Alternatives considered**:
- *Reuse `remoteBranchExists("develop")`*: simpler, but a transient failure would silently switch flow.
- *Check the local `refs/remotes/origin/develop`*: costs no round-trip, but it is wrong in a single-branch clone and in
  a clone that was never fetched.
- *Infer from the current branch* (on `develop` means gitflow): it guesses the procedure from where the operator happens
  to be standing, and it cannot produce the "wrong branch" refusal the spec requires.

### D-002 — An empty release commit on every trunk release

**Decision**: `git commit --allow-empty -m "chore(release): <version>"` always runs, whether or not the trunk is ahead
of `origin/<trunk>`.

**Rationale**: The branch-push CI fires only when the trunk ref moves. GitFlow's `merge --no-ff` guarantees that move,
and the empty commit plays the same role here. Committing unconditionally also means the tagged commit is always one
made for the release, and the precondition does not need to check whether the trunk is ahead.

**Alternatives considered**:
- *Require the trunk to be ahead*: this was the first proposal on the issue. The maintainer rejected it for the empty
  commit, since a changelog roll that was already pushed would block the release.
- *Tag-only push with a tag-triggered CI*: no automata change would be needed in other repositories' pipelines, but this
  repository's CI would need a new trigger. It was rejected on the issue.

### D-003 — `git push --atomic origin <trunk> <version>`

**Decision**: Push the trunk and the tag in a single atomic push.

**Rationale**: The `publish` job reads `git tag --points-at HEAD` on the branch-push checkout, so the tag must reach
`origin` no later than the branch. `--atomic` also rules out the half-failure where the tag lands and the branch is
rejected, which would leave a published tag no CI ever built. The probe table confirms that GitHub-compatible remotes
honour it.

**Alternatives considered**: *two pushes* (branch, then tag): this is the exact race that makes `publish` fail with "No
version tag found on HEAD".

### D-004 — The release plan is a pure function

**Decision**: Move the step list out of `publishRelease()` into `planRelease(flow, version, trunk, trunkIsLocal)` in a
new pure module, `src/git/releaseFlow.ts`. `publishRelease()` keeps only the loop that prints or executes the steps.

**Rationale**: Two flows mean two step lists. As pure data they can be tested without mocking `spawnSync`, and the dry
run and the real run are guaranteed to use the same list. This follows the `trunkDetection.ts` precedent of a pure
sibling beside `gitService.ts`.

**Alternatives considered**: *branching inside `publishRelease()`*: fewer files, but the step lists could then only be
tested through argv assertions.

### D-005 — The flow is resolved after the trunk, and the branch precondition takes the expected branch

**Decision**: The command order is: resolve trunk → resolve flow → preconditions (current branch equals `develop` or
the trunk, then a clean tree) → the unchanged fetch, version, tag, changelog and behind checks → run the plan.

**Rationale**: The trunk flow's branch precondition needs the trunk name, so the check cannot keep running before
trunk resolution. `checkReleasePreconditions(expectedBranch)` keeps both error messages in one function.

**Alternatives considered**: *keep the develop check first and add a second check later*: it would refuse every
trunk-flow run before the flow is known.

## Autonomous Decisions

- **Invalid `git.releaseFlow`**: refused with a message naming the accepted values, rather than falling back to
  detection. An explicit opt-out must not be silently overridden.
- **Setter shape**: `config set git-release-flow <gitflow|trunk>`, with no clearing value, the same as
  `git-trunk-branch`. The wizard's "Detect from origin" option clears the key.
- **Wizard**: a menu screen after `git-trunk-branch`, inside the existing `Git` entry. Enter saves both keys and
  exits; Esc returns to the trunk screen.
- **Failed push recovery**: documented rather than automated (`git tag -d <version>` then `git reset --soft HEAD~1`),
  which matches the gitflow flow's failure behaviour.
