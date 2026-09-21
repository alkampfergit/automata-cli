# Phase 0 Research: Changelog release gate

**Branch**: `feature/037-changelog-release-gate` | **Date**: 2026-09-21

## What actually failed

CI run [35383728708](https://github.com/alkampfergit/automata-cli/actions/runs/35383728708), push to `master`,
`Merge branch 'release/0.8.0'`:

```
Test Files  1 failed | 43 passed (44)
      Tests  1 failed | 1321 passed (1322)

FAIL tests/unit/changelog.test.ts > CHANGELOG.md structure > has a section for every released tag
AssertionError: released versions with no CHANGELOG.md section: expected [ '0.8.0' ] to deeply equal []
```

Established from the repository:

| Fact | Evidence |
|---|---|
| The `0.8.0` tag exists | `git log -1 0.8.0` → `f9b9bc6 2026-09-18 (tag: 0.8.0, origin/master)` `Merge branch 'release/0.8.0'` |
| `CHANGELOG.md` has no `0.8.0` section | top released heading is `## [0.7.0] - 2026-09-16`, on both `master` and `develop` |
| The 0.8.0 content was never rolled | `git show 0.8.0:CHANGELOG.md` shows that content still under `## [Unreleased]` |
| `develop` and `master` agree | `git rev-list --count origin/master..origin/develop` → `0` |
| 0.8.0 never shipped | `npm view automata-cli dist-tags` → `{ latest: '0.7.0', dev: '0.8.0-develop.358' }`; no `v0.8.0` tag |

The last row is the consequence that matters beyond a red badge. `.github/workflows/ci.yml` makes `publish` depend on
`build` and `release` depend on `publish`, so the failing unit test stopped the npm publish and the GitHub release. A
skipped documentation step silently became a skipped release.

The test is repository-wide, not branch-wide: `releasedVersions()` shells out to `git tag`, and tags are not scoped to a
branch. So one missing section fails every branch in the repository, which is why the symptom looks disproportionate to
the cause.

## Decisions

### Decision: add the missing section; do not weaken the test

**Rationale**: `tests/unit/changelog.test.ts` did exactly what 035 built it for — its own header says the file "rotted"
undetected precisely because nothing checked it. Relaxing the assertion to make the build green would delete the only
mechanism that noticed, and would do so in response to its first true positive.

**Alternatives considered**:

- *Exclude `0.8.0` from the check.* An allow-list of undocumented versions is a permanent record of a temporary
  omission, and the next one gets added to it.
- *Delete the `0.8.0` tag.* Rewrites published release history to make a documentation problem disappear, and the tag is
  what CI derives the published version from.

### Decision: the gate is a `publish-release` precondition, not a CI step

**Rationale**: the gate has to refuse *before* the tag exists. A CI check runs after the tag is pushed to the trunk —
which is exactly the state #80 is in, where recovery now requires moving a published tag or burning a version. The
precondition is also the only form that a `--dry-run` can rehearse.

**Alternatives considered**:

- *A workflow step that fails the build.* Strictly later than the tag; it reproduces the failure rather than preventing
  it. It also needs the `workflow` OAuth scope, which project memory records as a recurring obstacle.
- *A standalone `automata changelog check` subcommand.* Adds a command a maintainer must remember to run, which is the
  same reliance on memory that failed here.
- *A git hook.* Not versioned with the repository by default and trivially bypassed with `--no-verify`.

### Decision: an absent or unreadable `CHANGELOG.md` passes the gate

**Rationale**: `automata` is published to npm and run against other repositories, most of which keep no changelog.
Failing closed would make `publish-release` unusable for them — a regression much larger than the problem being solved.
Project memory states the general form of this: "a gate that blocks unrelated work gets disabled, not fixed."

**Alternatives considered**:

- *Fail closed.* Correct for this repository, wrong for every consumer of the CLI.
- *A `--skip-changelog-check` escape hatch.* A flag that exists will be used in exactly the situation the gate is for.
  The absent-file case is the legitimate escape and it needs no flag.
- *A `changelog.required` config key.* Same objection, plus two more places to keep in sync (a `config set` subcommand
  and a wizard screen, per the project's "reachable two ways" rule) for a setting whose only correct value here is on.

### Decision: the gate matches `## [X.Y.Z] - YYYY-MM-DD` exactly, the same pattern as the test

**Rationale**: the gate's whole purpose is keeping `tests/unit/changelog.test.ts` green. A looser pattern — accepting
`## [0.9.0]` with no date, or a mention inside a bullet — would let a release through that the test then rejects,
leaving the same red build with an extra layer of indirection in front of it.

**Alternatives considered**:

- *Substring search for the version.* Matches the link-reference footer `[0.9.0]: https://…/compare/…` and any bullet
  that happens to name the version.
- *Import the pattern from the test into `src/`, or vice versa.* Rejected in the other direction: a test that imports
  the implementation it validates stops being an independent check. The duplication is two regexes of the same literal
  shape, and each site carries a comment naming the other.

### Decision: pure decider in `src/git/changelogGate.ts`, I/O confined to one function

**Rationale**: this mirrors `src/git/releaseVersion.ts`, which exists for the same reason — release-time decisions kept
out of `gitService.ts` so every branch is testable without a repository. Project memory records the companion rule for
the I/O half: one entry point whose body is a silent `try`/`catch`, taking the directory as a defaulted parameter so a
test can point it at a temp directory without stubbing `process.cwd`.

**Alternatives considered**:

- *Inline the read and the regex in `src/commands/git.ts`.* The action is already ~90 lines and every branch would then
  need the full `spawnSync` stub table to reach.
- *Add it to `gitService.ts`.* That module owns the private `spawnSync` runner; pure logic placed there inherits the
  need to mock `node:child_process`.

### Decision: the command tests mock the reader, defaulting to `null`

**Rationale**: the existing `publish-release` CLI tests release `1.3.0` against the real working directory, whose
`CHANGELOG.md` has no `1.3.0` section. A gate reading the real file would fail eleven unrelated tests. Mocking
`readChangelog` with a default of `null` keeps them green by exercising the documented skip path, and lets the two new
tests supply the text they need. The factory uses `importOriginal()` and spreads the real module, which project memory
records as the form immune to a missing-named-export breaking every test in the file.

**Alternatives considered**:

- *Give the tests a real `CHANGELOG.md` in a temp cwd.* `publish-release` resolves nothing else relative to cwd, so
  this would add a `process.chdir` to a suite that has none.
- *Add a `1.3.0` section to the repository's own changelog.* Documents a version that does not exist to satisfy a test.

## Autonomous Decisions

Every question this feature raised was resolved from the repository rather than deferred; each is recorded above with
its rationale and the alternatives rejected, and mirrored in the spec's Assumptions section as an `[AUTO]` entry. No
`NEEDS CLARIFICATION` marker survives into the plan.

## Deliberately out of scope

**Republishing 0.8.0.** The fix makes future releases correct and CI green; it does not restore the release that was
lost. Restoring it means either moving the published `0.8.0` tag onto a commit that contains the changelog fix, or
abandoning 0.8.0 and cutting 0.8.1. Both touch npm and GitHub releases, both are irreversible from a consumer's point
of view, and both are the maintainer's call — so the pull request states the choice rather than making it.
