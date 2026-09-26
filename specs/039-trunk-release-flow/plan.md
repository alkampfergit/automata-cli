# Implementation Plan: Trunk-based release flow

**Branch**: `feature/039-trunk-release-flow` | **Date**: 2026-09-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/039-trunk-release-flow/spec.md`

## Summary

`publish-release` hard-codes `develop` in its branch precondition and in its step list, so a repository with only
`main` or `master` cannot release. This change adds a release flow: `gitflow`, which is unchanged, or `trunk`. It comes
from `git.releaseFlow`, or when that is unset it is detected by whether `origin` has a `develop` branch. The trunk flow
runs from the trunk branch and does three things: it creates an empty `chore(release): <version>` commit, tags it, and
runs `git push --atomic origin <trunk> <version>`. The trunk ref therefore always moves, the tag arrives in the same
push, and the existing branch-push CI publishes the release.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode)

**Primary Dependencies**: commander.js, plus `node:child_process` `spawnSync` through `gitService`'s private `run()`.
No new dependency.

**Storage**: `.automata/config.json` gets one new optional key, `git.releaseFlow`.

**Testing**: vitest. Pure unit tests for the plan and the source text, argv-level service tests that mock `spawnSync`,
CLI tests through `gitCommand.parseAsync` with the existing `classifyGitCall` stub, and the config command and wizard
tests.

**Target Platform**: Node.js 22.12+ CLI, with `git` on `PATH`.

**Project Type**: Single-project CLI.

**Constraints**: No mutating git command may run under `--dry-run`. Flow resolution and every precondition must
finish before the first ref is written.

**Scale/Scope**: One command, one new pure module, one config key with a setter and a wizard screen.

## Constitution Check

| Principle | Assessment |
|---|---|
| I. CLI-First Design | No new command and no new flag. Errors go to stderr with exit 1, and the progress lines go to stdout. ✅ |
| II. TypeScript Strictness | `ReleaseFlow` is a literal union. Flow resolution returns a discriminated union that carries its source or the failure message. No `any`. ✅ |
| III. Single Responsibility | Git I/O stays in `gitService.ts`. The plan, the provenance text and the validation are pure, in `src/git/releaseFlow.ts`. ✅ |
| IV. npm Distribution | No dependency or build change. ✅ |
| V. Simplicity | Two step lists as data, rather than a strategy hierarchy. One key, no flag. ✅ |

Re-check after design: unchanged, so there is no Complexity Tracking section.

## Project Structure

```text
src/
├── git/
│   ├── releaseFlow.ts     # NEW — pure: ReleaseFlow, isReleaseFlow, describeReleaseFlowSource, planRelease
│   └── gitService.ts      # CHANGED — probeRemoteBranch, resolveReleaseFlow,
│                          #   checkReleasePreconditions(expectedBranch), publishRelease(plan runner)
├── commands/
│   ├── git.ts             # CHANGED — flow resolution, flow line, help text
│   └── config.ts          # CHANGED — `config set git-release-flow`
└── config/
    ├── configStore.ts     # CHANGED — AutomataGitConfig.releaseFlow
    └── ConfigWizard.tsx   # CHANGED — git-release-flow menu screen after git-trunk-branch

tests/unit/
├── releaseFlow.test.ts    # NEW
├── publishRelease.test.ts # CHANGED
├── git.commands.test.ts   # CHANGED
├── config.cmd.test.ts     # CHANGED
└── ConfigWizard.test.tsx  # CHANGED

docs/git.md, docs/config.md, CHANGELOG.md, AGENTS.md
```

**Structure Decision**: This keeps the 036 precedent of a pure module beside the I/O service.

## Phase 1 — Design

### Contract

```ts
// src/git/releaseFlow.ts (pure)
export type ReleaseFlow = "gitflow" | "trunk";
export const RELEASE_FLOWS: readonly ReleaseFlow[];
export const RELEASE_FLOW_CONFIG_KEY = "git.releaseFlow";
export type ReleaseFlowSource = "config" | "develop-present" | "develop-absent";
export function isReleaseFlow(value: unknown): value is ReleaseFlow;
export function describeReleaseFlowSource(source: ReleaseFlowSource): string;
export function invalidReleaseFlowMessage(value: unknown): string;
export interface ReleaseStep { args: string[]; desc: string }
export function planRelease(flow: ReleaseFlow, version: string, trunk: string, trunkIsLocal: boolean): ReleaseStep[];

// src/git/gitService.ts (I/O)
export type RemoteBranchProbe = { ok: true; exists: boolean } | { ok: false; message: string };
export function probeRemoteBranch(branch: string): RemoteBranchProbe;
export type ReleaseFlowResolution =
  | { ok: true; flow: ReleaseFlow; source: ReleaseFlowSource }
  | { ok: false; message: string };
export function resolveReleaseFlow(): ReleaseFlowResolution;
export function checkReleasePreconditions(expectedBranch: string): ReleasePreconditionResult;
export function publishRelease(version: string, dryRun: boolean, trunk: string, flow: ReleaseFlow): void;
```

### Command flow

1. resolve the trunk (unchanged)
2. **resolve the flow**, or exit 1
3. preconditions: the current branch is `develop` (gitflow) or `<trunk>` (trunk), and the tree is clean
4. print `Trunk branch: …` and **`Release flow: <flow> (<source>)`**
5. fetch, version, tag exists, changelog gate, behind check (all unchanged)
6. `publishRelease(version, dryRun, trunk, flow)`

### Trunk plan

| # | Command |
|---|---|
| 1 | `git commit --allow-empty -m "chore(release): <version>"` |
| 2 | `git tag <version>` |
| 3 | `git push --atomic origin <trunk> <version>` |

### Config contract

```jsonc
{ "git": { "trunkBranch": "main", "releaseFlow": "trunk" } }  // releaseFlow optional; absent ⇒ detect
```

## Complexity Tracking

Not applicable.
