# Implementation Plan: Release Trunk Detection

**Branch**: `feature/036-release-trunk-detection` | **Date**: 2026-09-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/036-release-trunk-detection/spec.md`

## Summary

`automata git publish-release` hardcodes `master` in three places — version inference
(`getLatestTagOnMaster`), the checkout step and the final push — and never fetches. On a clone that
only has `develop` locally, `git describe … master` fails and the command reports "No semver tag
found on master"; on a repository whose trunk is `main` it fails for a second, independent reason.

The fix resolves the trunk name once, before any git mutation: configured override → `origin/HEAD`
→ `git ls-remote --symref origin HEAD` → probe `origin/main` / `origin/master`. It then fetches tags
and the trunk ref into `refs/remotes/origin/<trunk>` with an explicit refspec (so a `--single-branch`
clone gets the ref too), infers the version from `origin/<trunk>`, refuses when a local trunk branch
is behind the remote, and threads the resolved name through the checkout, merge, tag and push steps.
A new `git.trunkBranch` config key pins the name when detection is not wanted.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode)

**Primary Dependencies**: commander.js (CLI), `node:child_process` `spawnSync` via `gitService`'s
private `run()` helper. No new dependency.

**Storage**: `.automata/config.json` — one new optional top-level `git` section.

**Testing**: vitest. Unit tests for the pure parsers, argv-level tests for the service functions
(mocking `spawnSync`), CLI precondition tests through `gitCommand.parseAsync`.

**Target Platform**: Node.js 22.12+ CLI, any platform with `git` on `PATH`.

**Project Type**: Single-project CLI.

**Performance Goals**: N/A — the added work is one `git fetch` per invocation, which the command
needs anyway to push.

**Constraints**: No mutating git command may run under `--dry-run`. Trunk resolution and every
precondition must complete before the first mutation, so a failure leaves the repository untouched.

**Scale/Scope**: One command (`publish-release`), one service file, one new pure module, one config
key, one wizard screen.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|---|---|
| I. CLI-First Design | No new command; the existing subcommand keeps its argument and `--dry-run` flag. Errors go to stderr with exit code 1, progress to stdout. `publish-release` has no `--json` mode today and none is added, consistent with the command's shape. ✅ |
| II. TypeScript Strictness | New exports carry explicit types; the resolution result is a discriminated union (`ok: true/false`) rather than a nullable string, so the failure case carries the attempted candidates. No `any`. ✅ |
| III. Single Responsibility | Git I/O stays in `src/git/gitService.ts` (it owns the `spawnSync` runner); the pure parsing and candidate-ordering logic goes in a sibling `src/git/trunkDetection.ts`. No logic is duplicated into the command file. ✅ |
| IV. npm Distribution | No new runtime dependency, no build change. ✅ |
| V. Simplicity | One new module of pure functions, justified by testability without a `git` process; the alternative (inline parsing in `gitService`) is untestable without mocking every probe. The config key is a single optional string, added because the spec requires an escape hatch. ✅ |

Re-check after design: unchanged — no violation, `## Complexity Tracking` is therefore omitted.

## Project Structure

### Documentation (this feature)

```text
specs/036-release-trunk-detection/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── spec.md              # Feature specification
├── tasks.md             # Phase 2 output
├── pr-report.md         # Reviewer-facing summary
└── spec-decisions.md    # Planning decisions appendix
```

### Source Code (repository root)

```text
src/
├── git/
│   ├── trunkDetection.ts      # NEW — pure: parse refs, candidate order, error text
│   └── gitService.ts          # CHANGED — resolveTrunkBranch, fetchTrunkAndTags,
│                              #   getLatestTagOnTrunk, localBranchExists,
│                              #   trunkBehindCount, remoteBranchExists, publishRelease
├── commands/
│   ├── git.ts                 # CHANGED — publish-release preconditions + reporting
│   └── config.ts              # CHANGED — `config set git-trunk-branch`
└── config/
    ├── configStore.ts         # CHANGED — AutomataGitConfig / `git.trunkBranch`
    └── ConfigWizard.tsx       # CHANGED — "Git" main-menu entry + trunk screen

tests/unit/
├── trunkDetection.test.ts     # NEW — pure parser/ordering unit tests
├── publishRelease.test.ts     # CHANGED — service-level argv assertions
├── git.commands.test.ts       # CHANGED — CLI preconditions
├── config.commands.test.ts    # CHANGED — new setter
└── ConfigWizard.test.tsx      # CHANGED — new menu entry + screen

docs/
├── git.md                     # CHANGED — publish-release reference
├── config.md                  # CHANGED — new key
└── maintenance.md             # CHANGED — release runbook wording
```

**Structure Decision**: The existing flat `src/<area>/` layout is kept. `gitService.ts` keeps every
`spawnSync` call because it owns the private `run()` helper and duplicating it would violate
principle III; the new `trunkDetection.ts` holds only pure functions over strings, matching the
established `src/github/issueConversation.ts` / `src/git/repoHygiene.ts` precedent of a pure sibling
beside an I/O service.

## Phase 0 — Research

See [research.md](./research.md) for the decisions, their rationale and the alternatives considered.

## Phase 1 — Design

### Contract: trunk resolution

```ts
// src/git/trunkDetection.ts (pure)
export type TrunkSource = "config" | "origin-head" | "ls-remote" | "probe";
export const TRUNK_CANDIDATES: readonly string[];          // ["main", "master"]
export function parseOriginHeadRef(stdout: string): string | null;   // refs/remotes/origin/main → main
export function parseLsRemoteSymref(stdout: string): string | null;  // "ref: refs/heads/main\tHEAD" → main
export function describeTrunkSource(source: TrunkSource, branch: string): string;
export function unresolvedTrunkMessage(attempted: readonly string[]): string;

// src/git/gitService.ts (I/O)
export type TrunkResolution =
  | { ok: true; branch: string; source: TrunkSource }
  | { ok: false; attempted: string[] };
export function resolveTrunkBranch(): TrunkResolution;
export function fetchTrunkAndTags(trunk: string): { ok: true } | { ok: false; message: string };
export function getLatestTagOnTrunk(ref: string): string | null;
export function localBranchExists(branch: string): boolean;
export function trunkBehindCount(trunk: string): number;
export function remoteBranchExists(branch: string): boolean;
export function publishRelease(version: string, dryRun: boolean, trunk: string): void;
```

### Command flow (`publish-release`)

1. current branch is `develop` *(unchanged)*
2. working tree clean *(unchanged)*
3. **resolve trunk** → on failure print the attempted candidates and exit 1
4. print `Trunk branch: <trunk> (<how it was resolved>)`
5. **fetch** `git fetch --tags origin +refs/heads/<trunk>:refs/remotes/origin/<trunk>` → on failure exit 1
6. version: explicit argument validated as before, otherwise `getLatestTagOnTrunk("origin/<trunk>")`
   → `bumpMinorVersion`; the "no semver tag" error names `origin/<trunk>`
7. tag must not already exist *(unchanged, now checked after the fetch so remote tags count)*
8. **local trunk not behind** `origin/<trunk>` → otherwise exit 1
9. `publishRelease(version, dryRun, trunk)`

Steps 3–8 are read-only and all run under `--dry-run`.

### Release sequence emitted by `publishRelease`

| # | Command | Change |
|---|---|---|
| 1 | `git checkout -b release/<version>` | — |
| 2 | `git checkout <trunk>` or `git checkout -b <trunk> --track origin/<trunk>` | trunk name; second form when the local branch is absent |
| 3 | `git merge --no-ff release/<version>` | — |
| 4 | `git tag <version>` | — |
| 5 | `git checkout develop` | — |
| 6 | `git merge --no-ff release/<version>` | — |
| 7 | `git branch -d release/<version>` | — |
| 8 | `git push origin develop <trunk> <version>` | trunk name |

### Config contract

```jsonc
{ "git": { "trunkBranch": "main" } }   // optional; absent or blank ⇒ detect
```

- `automata config set git-trunk-branch <name>` — rejects an empty value, like every sibling setter.
- Wizard: a new `Git` entry appended last to the main menu → one text screen; blank clears the key.

## Complexity Tracking

Not applicable — the Constitution Check records no violations.
