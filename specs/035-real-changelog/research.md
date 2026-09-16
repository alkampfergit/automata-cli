# Phase 0 Research: A real, maintained CHANGELOG

## How a release actually happens in this repository

Established by reading `.github/workflows/ci.yml`, `docs/git.md` (`publish-release`) and `package.json`:

1. `automata git publish-release [version]` runs from a clean `develop`: it creates `release/<version>`, merges it into
   `master` with `--no-ff`, tags `master` with the bare `<version>`, back-merges into `develop`, deletes the release
   branch and pushes `develop master <version>`.
2. The CI `publish` job derives the npm version from the git tag on `master` (`HEAD_TAG`, `v` stripped) and publishes
   under the `latest` dist-tag. `develop` pushes publish `X.(Y+1).0-develop.<run>` under `dev`; `release/*` pushes
   publish `-next.<run>`.
3. The CI `release` job creates the GitHub release for `v<version>` with `generate_release_notes: true`.

Three consequences for this feature:

- **`package.json` version is not the release version.** It has read `0.1.0` since the first commit; CI overwrites it
  with `npm version --no-git-tag-version` at publish time. So the changelog's headings must be driven by git tags, and
  no test may compare a changelog heading to `package.json`.
- **Two tags exist per release** — `0.6.0` from `publish-release` and `v0.6.0` from the GitHub release action. Any
  tag-derived check must normalise the `v`.
- **GitHub release notes already exist and are per-commit.** The changelog's job is therefore the human summary, not a
  second commit list.

## Decisions

### Decision: Keep a Changelog 1.1.0 format

**Rationale**: it is the convention npm consumers expect, its `## [X.Y.Z] - YYYY-MM-DD` heading is trivially
machine-checkable, and the existing file's `## [0.1.0] - Initial Release` is already the same shape minus the date.

**Alternatives considered**: free-form prose (nothing to test, drifts again); generated from commits by a tool such as
`conventional-changelog` (adds a dev dependency and a build step to produce the per-commit list GitHub already
generates, and the pre-0.5.0 history is not consistently conventional — `Probably to delete`, `Mocked tests`,
`Restored configurartion`).

### Decision: reconstruct history per tag range, one bullet per user-visible change

**Rationale**: `git log <prev>..<tag>` is the only surviving record. Merging a spec-kit run's follow-up commits
(`feat(032): add --effort …` + `fix(032): escape the codex TOML override …`) into one bullet gives the reader the
change rather than the branch's edit history.

**Alternatives considered**: one bullet per commit (duplicates the auto-generated release notes, and surfaces
bookkeeping commits like `docs: initialise PR artifacts`); only documenting minors and folding the patches in (loses
`0.2.1`/`0.2.2`, and a version with no section reads as a lost release).

### Decision: structural test in `tests/unit/changelog.test.ts`, tag coverage degrading to a reported skip

**Rationale**: the repo already pins policy in tests — `tests/unit/ciAuditGate.test.ts` asserts the exact `audit:prod`
/ `prepublishOnly` wiring so the release gate cannot be quietly removed. The changelog rotted for eight releases
because nothing failed when it did. Format assertions (leading `Unreleased`, dated headings, strictly descending
versions, known categories) need nothing but the file. The coverage assertion needs `git tag`, which is present in CI
(`fetch-depth: 0`, `fetch-tags: true`) but may be missing in a shallow clone; there it reports that it could not check
instead of failing a legitimate environment, while the format assertions still run unconditionally.

**Alternatives considered**: no test at all (the failure mode the feature exists to stop); hard-failing when no tags
are found (makes `npm test` depend on how the repo was cloned); asserting against a hard-coded version list (goes stale
the moment `0.7.0` ships — the check must read the tags).

### Decision: the convention lives in `docs/maintenance.md`, linked from `docs/git.md` and `AGENTS.md`

**Rationale**: `AGENTS.md` reserves `docs/<group>.md` for command groups; the changelog is release policy, and
`docs/maintenance.md` already carries exactly that kind of non-command policy (the audit release gate, Dependabot
scope, deferred upgrades). One authoritative page, two pointers — `docs/git.md` because `publish-release` is what cuts
a release, `AGENTS.md` because that is what an agent reads before finishing a branch.

**Alternatives considered**: a new `docs/changelog.md` (a whole page for one convention, and `README.md`'s command
table would then want a row for a non-command); putting the rule only in `CHANGELOG.md`'s own header (contributors do
not open the file they are forgetting to update).

### Decision: `publish-release` is not taught to roll `Unreleased` into a version heading

**Rationale**: issue #71 asked to modify the changelog. Automating the roll means a new precondition (refuse to release
with an empty `Unreleased`?), new `--dry-run` output, a file write inside a command that today only runs git, and a
failure mode half-way through the release sequence. That is its own feature with its own spec.

**Alternatives considered**: doing it now (scope creep into the command that performs an irreversible push); a
`lint:changelog` script (a second entry point for what `npm test` now covers).

### Decision: `CHANGELOG.md` stays out of `package.json`'s `files`

**Rationale**: the published tarball is `dist` + `README.md` today. Adding the changelog changes what every consumer
downloads — a packaging decision, unrelated to making the file true.

**Alternatives considered**: adding it (defensible, but it belongs to whoever next revisits the tarball contents).

## Autonomous Decisions

Every decision above was taken without user input; each is also recorded as an `[AUTO]` assumption or clarification in
`spec.md`. No `NEEDS CLARIFICATION` marker remained after Phase 1.
