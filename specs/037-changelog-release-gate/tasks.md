# Tasks: Changelog release gate

**Branch**: `feature/037-changelog-release-gate` | **Date**: 2026-09-21

**Input**: [spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md)

Tasks are grouped by user story. Each story's block is independently shippable and independently verifiable. `[P]`
marks tasks that touch disjoint files and may run in parallel.

---

## Phase 1: User Story 1 — CI goes green again (P1)

**Goal**: `tests/unit/changelog.test.ts` passes in a clone carrying the repository's tags.

**Independent verification**: `npm run test:unit -- tests/unit/changelog.test.ts`

- [X] **T001** Confirm the failure and its cause from the repository, not from the issue text: the `0.8.0` tag's commit
      and date (`git log -1 0.8.0`), the absence of a `0.8.0` heading in `CHANGELOG.md`, and that `git show
      0.8.0:CHANGELOG.md` carries that release's bullets under `## [Unreleased]`.
- [X] **T002** In `CHANGELOG.md`, rename `## [Unreleased]` to `## [0.8.0] - 2026-09-18` and open a fresh, empty
      `## [Unreleased]` above it, per the roll procedure in `docs/maintenance.md#what-a-release-does-to-it`. Do not
      rewrite the bullets — they are what shipped.
- [X] **T003** Run `npm run test:unit -- tests/unit/changelog.test.ts` and confirm all five assertions pass, including
      the descending-order and date-monotonicity checks against the new heading.

**Checkpoint**: CI is green on this branch and the build is unblocked, with nothing else in the branch yet.

---

## Phase 2: User Story 2 — A release refuses to start without its changelog section (P1)

**Goal**: `publish-release` refuses, read-only and before any ref is written, when `CHANGELOG.md` does not document the
version being released.

**Independent verification**: `npm run test:unit -- tests/unit/changelogGate.test.ts tests/unit/git.commands.test.ts`

### Tests first

- [X] **T004** Write `tests/unit/changelogGate.test.ts` covering `checkChangelogSection`: a matching
      `## [X.Y.Z] - YYYY-MM-DD` heading passes; a missing heading fails with a message naming the expected heading; an
      undated heading (`## [0.9.0]`) fails; a version named only in a bullet or a link-reference footer fails; a
      different version's heading does not satisfy the one requested; `null` input passes.
- [X] **T005** [P] Extend the same file with `readChangelog` tests against a temp directory: returns the file's text
      when present, returns `null` when the directory has no `CHANGELOG.md`, and returns `null` rather than throwing
      when the path is unreadable (a directory named `CHANGELOG.md`).
- [X] **T006** [P] Extend `tests/unit/git.commands.test.ts`: mock `src/git/changelogGate.js` via `importOriginal()` with
      `readChangelog` defaulting to `null` so the existing precondition tests are unaffected, then add — the command
      exits 1 and executes no `git checkout`/`tag`/`merge`/`push` when the changelog lacks the section; the release
      proceeds when it has it; `--dry-run` refuses identically.

### Implementation

- [X] **T007** Add `src/git/changelogGate.ts`: a `ChangelogGateResult` discriminated union, a pure
      `checkChangelogSection(version, changelog)` matching `## [X.Y.Z] - YYYY-MM-DD` line-wise, and a
      `readChangelog(dir = process.cwd())` whose whole body is a silent `try`/`catch` returning `string | null`.
      Comment the deliberate duplication of the heading pattern with `tests/unit/changelog.test.ts`.
- [X] **T008** Wire the precondition into `publish-release` in `src/commands/git.ts`, immediately after the
      "tag already exists" check so a refusal predates every ref write and applies under `--dry-run`.
- [X] **T009** Note the deliberate pattern duplication in `tests/unit/changelog.test.ts` so the two copies point at each
      other.

**Checkpoint**: a release with no changelog section is refused; one with a section behaves exactly as before.

---

## Phase 3: Documentation

- [X] **T010** [P] `docs/git.md`: document the precondition under `automata git publish-release` — what is checked, the
      exact heading expected, that an absent `CHANGELOG.md` skips the check, and that `--dry-run` enforces it too.
- [X] **T011** [P] `docs/maintenance.md`: record under "What a release does to it" that the roll is now enforced by the
      command rather than only documented, and note in "The structural test" that 0.8.0 was the omission that motivated
      the gate.
- [X] **T012** [P] `CHANGELOG.md`: add the new precondition as an `Added` bullet under the fresh `## [Unreleased]`.

---

## Phase 4: Validation

- [X] **T013** Run `npm test && npm run lint`; both green.
- [X] **T014** Verify no README change is warranted — installation, quick start, the command-group table and dev setup
      are all untouched by this feature, per the documentation convention in `AGENTS.md`.

---

## Dependencies

- T002 depends on T001. T003 depends on T002.
- T007 depends on T004 and T005 (tests first). T008 depends on T007. T006 may be written before T007 but only passes
  after T008.
- Phase 3 depends on Phase 2 being implemented. Phase 4 depends on everything.
- Phase 1 has no dependency on Phase 2 and can ship alone.
