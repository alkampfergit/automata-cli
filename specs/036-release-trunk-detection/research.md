# Phase 0 Research: Release Trunk Detection

**Feature**: `feature/036-release-trunk-detection` | **Date**: 2026-09-18

Every git behaviour below was verified against two throwaway repositories built with `git init` — a
full clone and a `git clone --single-branch --branch develop` clone — rather than assumed. The
single-branch clone is the exact shape reported in issue #76.

## Verified git behaviour

| Probe | Full clone | `--single-branch --branch develop` clone |
|---|---|---|
| `git symbolic-ref --quiet refs/remotes/origin/HEAD` | `refs/remotes/origin/master`, exit 0 | **no output, exit 1** |
| `git ls-remote --symref origin HEAD` | `ref: refs/heads/master\tHEAD` | `ref: refs/heads/master\tHEAD` |
| `git describe --tags --abbrev=0 … origin/master` before fetching | works | `fatal: Not a valid object name origin/master` |
| `git fetch --tags origin +refs/heads/master:refs/remotes/origin/master` | no-op/updates | `* [new branch] master -> origin/master` |
| `git describe … origin/master` after that fetch | works | **works** |
| `git checkout -b master --track origin/master` | works | **`fatal: cannot set up tracking information; starting point 'origin/master' is not a branch`** |
| `git checkout -b master origin/master` | works | **works** |
| `git rev-list --count refs/heads/master..refs/remotes/origin/master` | count, exit 0 | exit 128 while no local `master` exists |

## Decisions

### D-001 — Resolution order: config → `origin/HEAD` → `ls-remote --symref` → probe

**Decision**: Try the `git.trunkBranch` config value first; then
`git symbolic-ref --quiet refs/remotes/origin/HEAD`; then `git ls-remote --symref origin HEAD`; then
probe `main` and `master` with `git ls-remote --exit-code --heads origin <candidate>`. Fail with the
list of everything tried when none answers.

**Rationale**: The probe table shows why all four rungs are needed. `origin/HEAD` is free and local,
but it is **absent exactly in the reported scenario** — a single-branch clone never writes it — so it
cannot be the only detection step. `ls-remote --symref` answers correctly in both clone shapes but
costs a network round-trip, so it belongs below the local check. The `main`/`master` probe covers a
remote that advertises no HEAD symref at all.

**Alternatives considered**:
- *`ls-remote --symref` only*: simpler, but a network call on every run when a local ref already holds
  the answer.
- *Probe `main`/`master` only*: cannot serve a repository whose trunk is named anything else, which is
  the class of bug being fixed rather than a narrower instance of it.
- *Read `git config remote.origin.HEAD`*: not written by `clone` in either shape tested.

### D-002 — Fetch with an explicit refspec, not a bare `git fetch --tags origin <trunk>`

**Decision**: `git fetch --tags origin +refs/heads/<trunk>:refs/remotes/origin/<trunk>`.

**Rationale**: A single-branch clone's `remote.origin.fetch` is
`+refs/heads/develop:refs/remotes/origin/develop`, so a bare `git fetch origin master` updates
`FETCH_HEAD` but never creates `refs/remotes/origin/master` — and the whole design reads version
information from `origin/<trunk>`. The explicit refspec creates the ref in both clone shapes, as the
table shows.

**Alternatives considered**:
- *`git fetch --tags origin <trunk>` then `git describe FETCH_HEAD`*: works for inference, but leaves
  nothing for the checkout step or the behind-check to point at.
- *`git remote set-branches --add origin <trunk>`*: mutates repository configuration permanently, and
  would run under `--dry-run`, which must write nothing.

### D-003 — `git checkout -b <trunk> origin/<trunk>`, without `--track`

**Decision**: When the local trunk branch is absent, create it with
`git checkout -b <trunk> origin/<trunk>`.

**Rationale**: `--track` **fails** in a single-branch clone (see table) because git refuses to set an
upstream from a ref the configured refspec does not cover — this is the second trap in the reported
scenario, and the obvious-looking `--track` form would have reintroduced the bug it was meant to fix.
The release sequence pushes by explicit branch name (`git push origin develop <trunk> <version>`), so
an upstream is not needed.

**Alternatives considered**:
- *`--track`*: rejected by the probe above.
- *`git branch <trunk> origin/<trunk>` then `git checkout <trunk>`*: two commands for one, and one
  more line to keep in step with the dry-run transcript.

### D-004 — Version inference reads `origin/<trunk>`, never the local branch

**Decision**: `getLatestTagOnTrunk("origin/<trunk>")` replaces `getLatestTagOnMaster()`. The parameter
is the full ref the caller wants described, so the function does no name-building of its own.

**Rationale**: It removes the local-branch requirement entirely, which is the defect. Passing the ref
rather than the branch name keeps the function honest about what it describes and lets a test assert
the exact argv.

**Alternatives considered**: *Materialise the local trunk first, then describe it* — makes a read-only
path (`--dry-run`, and the inference step of a real run) mutate the repository.

### D-005 — A local trunk behind the remote aborts; it is never moved

**Decision**: When `refs/heads/<trunk>` exists and
`git rev-list --count refs/heads/<trunk>..refs/remotes/origin/<trunk>` is greater than zero, exit 1
with a message naming the branch and the count.

**Rationale**: Locked on issue #76. Fast-forwarding would silently move a branch the maintainer may
have work on, and this command's job is to publish a release, not to reconcile branches. The
`rev-list` form is guarded by an existence check because it exits 128 when the local branch is absent
(see table) — that case is "no local branch", not "behind".

**Alternatives considered**: *Fast-forward automatically* — rejected on the issue. *Ignore it* — the
merge would then produce a release commit missing remote history, and the push would be rejected.

### D-006 — A failed fetch is fatal

**Decision**: Exit 1 with git's own stderr when the fetch fails.

**Rationale**: The last step of the command is `git push origin …`, so a run that cannot reach the
remote cannot succeed anyway; continuing would only infer a version from stale tags and fail later,
after mutating the repository.

**Alternatives considered**: *Warn and continue* — makes the auto-detected version a guess, which is
precisely what the issue asks to stop doing.

### D-007 — Every precondition runs under `--dry-run`; no mutation does

**Decision**: Trunk resolution, the fetch, version inference, the tag-existence check and the
behind-check all run in dry-run mode. Checkout, branch creation, merge, tag and push do not.

**Rationale**: Locked on issue #76. A dry run whose version could differ from the real run is worse
than no dry run. The fetch is the only one of these that writes anything at all, and what it writes is
refs under `refs/remotes/` and `refs/tags/`, which is what "fetch" means.

**Alternatives considered**: *Skip the fetch in dry-run* — the previewed version could then differ
from the real one, which defeats the flag.

### D-008 — Pure parsing lives in `src/git/trunkDetection.ts`

**Decision**: `parseOriginHeadRef`, `parseLsRemoteSymref`, the candidate list and the user-facing
message builders are pure functions in a new module; `gitService.ts` keeps every `spawnSync` call.

**Rationale**: `gitService.ts` owns the private `run()` helper, so moving I/O out would duplicate it
(constitution III). The parsers are where the interesting cases are — a tab-separated `ls-remote` line,
an absent `origin/HEAD` — and as pure functions they are testable without a `git` process. This mirrors
`src/github/issueConversation.ts` beside `src/github/*Service.ts`.

**Alternatives considered**: *Inline the parsing in `gitService`* — each case would then need a
`spawnSync` mock, and the module is already 1200 lines.

### D-009 — `git.trunkBranch` as a new top-level config section

**Decision**: Add `AutomataGitConfig { trunkBranch?: string }` at `config.git`, reachable through
`automata config set git-trunk-branch <name>` and a `Git` screen appended last to the wizard's main
menu. Blank in the wizard clears it.

**Rationale**: `publish-release` is not a `do-work` turn, and `doWork.*` is documented as the settings
of the unattended loop, so hanging a release setting there would mislead. Appending the menu entry
last is the established rule in this repository: `ConfigWizard.test.tsx` navigates by counting arrow
presses, so inserting an entry mid-list breaks unrelated tests.

**Alternatives considered**: *`doWork.trunkBranch`* — wrong scope. *A `--trunk` CLI flag only* — an
override that must be retyped every release is not the "set it once" escape hatch the spec asks for;
a flag can be added later without changing the config contract.

## Autonomous Decisions

No `NEEDS CLARIFICATION` markers survived Phase 1: every open question on issue #76 was settled there
and is recorded in the spec's Clarifications section. The remaining judgement calls — the `origin`
remote name, keeping `develop` hardcoded on the non-trunk side, fetch-failure fatality, trusting the
config override without a round-trip, and the definition of "behind" — are listed as `[AUTO]`
assumptions in the spec and are reflected in D-001 through D-009 above.
