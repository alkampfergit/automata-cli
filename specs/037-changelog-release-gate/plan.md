# Implementation Plan: Changelog release gate

**Branch**: `feature/037-changelog-release-gate` | **Date**: 2026-09-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/037-changelog-release-gate/spec.md`

## Summary

Two changes that share one cause. First, `CHANGELOG.md` gets the `## [0.8.0] - 2026-09-18` section the release never
received, which is what turns CI green again. Second, `automata git publish-release` gains a read-only precondition that
refuses to release a version `CHANGELOG.md` does not document — so the omission cannot recur silently.

The gate follows the shape `src/git/releaseVersion.ts` already established for release-time decisions: a pure function
that decides, kept out of `gitService.ts` and free of `spawnSync`, with the file read isolated in a single I/O entry
point whose body is a silent `try`/`catch`. The command calls the reader, hands the text to the decider, and treats a
`null` read as "this repository keeps no changelog" rather than as a failure.

## Technical Context

**Language/Version**: TypeScript 5.x, strict mode; Node.js 22.12+ runtime

**Primary Dependencies**: commander.js (CLI), `node:fs` `readFileSync` (changelog read) — no new packages

**Storage**: N/A — `CHANGELOG.md` is read, never written, by the CLI

**Testing**: vitest — pure-logic unit tests plus command-level tests that mock the reader

**Target Platform**: Linux/macOS/Windows developer machines and CI runners

**Project Type**: single-project CLI

**Performance Goals**: N/A — one file read of a few kilobytes, once per release

**Constraints**: the check must be read-only and must run before any ref is written, including under `--dry-run`

**Scale/Scope**: one new module (~60 lines), one precondition block in an existing command, one changelog section, two
documentation pages

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Note |
|---|---|---|
| I. CLI-First Design | PASS | The gate is a precondition of an existing commander subcommand; refusal goes to stderr with exit 1, and the `--help` text states the rule. No `--json` surface is involved. |
| II. TypeScript Strictness | PASS | Discriminated-union result type, explicit return annotations, no `any`. |
| III. Test-First | PASS | Every branch of the decider gets a unit test written before the implementation; the command wiring is covered in `git.commands.test.ts`. |
| IV. No duplication | PASS | The heading pattern lives in exactly one place in `src/`; `tests/unit/changelog.test.ts` keeps its own copy because a test that imports the code it checks stops being an independent check. That deliberate second copy is noted in both files. |
| V. Documentation | PASS | `docs/git.md` gains the precondition, `docs/maintenance.md` records that the roll is now enforced, `CHANGELOG.md` gains an `Unreleased` bullet. README untouched — no install, quick-start, command-table or dev-setup change. |

No violations; Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/037-changelog-release-gate/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── tasks.md             # Phase 2 output
├── pr-report.md         # Reviewer-facing summary
└── spec-decisions.md    # Planning decisions
```

No `data-model.md`, `quickstart.md` or `contracts/` — the feature adds no entity, no persisted state and no external
contract. The one data shape it introduces (a changelog heading) is described inline in the spec.

### Source Code (repository root)

```text
src/
├── git/
│   ├── changelogGate.ts        # NEW — readChangelog() + checkChangelogSection()
│   ├── releaseVersion.ts       # unchanged; the pattern this module follows
│   └── gitService.ts           # unchanged
└── commands/
    └── git.ts                  # publish-release gains one precondition block

tests/
└── unit/
    ├── changelogGate.test.ts   # NEW — decider branches + reader against a temp dir
    ├── git.commands.test.ts    # publish-release precondition tests extended
    └── changelog.test.ts       # unchanged; passes once 0.8.0 is documented

CHANGELOG.md                    # 0.8.0 section + fresh Unreleased
docs/git.md                     # publish-release precondition
docs/maintenance.md             # the roll is enforced, not merely documented
```

**Structure Decision**: single project, existing layout. The decider goes in `src/git/` beside `releaseVersion.ts`
because it answers a release-time question and is consumed only by `publish-release`; putting it in `gitService.ts`
would bury pure logic in the module that owns the `spawnSync` runner and make it untestable without a repository.

## Implementation Order

1. **Changelog roll** — independent of everything else and the only part that fixes CI. Rename `## [Unreleased]` to
   `## [0.8.0] - 2026-09-18`, open a fresh empty `## [Unreleased]` above it. Verifiable on its own with
   `npm run test:unit -- tests/unit/changelog.test.ts`.
2. **Decider tests, then the decider** — `checkChangelogSection` and `readChangelog` in `src/git/changelogGate.ts`.
3. **Command wiring** — the precondition block in `publish-release`, plus the `--help` text.
4. **Documentation** — `docs/git.md`, `docs/maintenance.md`, and the `Unreleased` bullet for the new precondition.

Step 1 ships value even if steps 2–4 are dropped, which is what makes it P1 in its own right.

## Complexity Tracking

> No Constitution Check violations. Section intentionally empty.
