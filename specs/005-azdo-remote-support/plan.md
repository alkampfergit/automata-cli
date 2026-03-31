# Implementation Plan: Azure DevOps Remote Support

**Branch**: `005-azdo-remote-support` | **Date**: 2026-03-31 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/005-azdo-remote-support/spec.md`

## Summary

Add Azure DevOps support to `automata git get-pr-info` and `automata git finish-feature` by dispatching PR queries to `azdo pr status --json` when `remoteType` is `azdo`. Update `get-ready` to emit a clear gap message for azdo mode. Ship `docs/azdo-gap.md` documenting all missing capabilities. All existing GitHub behaviour is unchanged.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode)
**Primary Dependencies**: commander.js (existing), azdo-cli (external tool, user-installed)
**Storage**: `.automata/config.json` (existing)
**Testing**: vitest (existing)
**Target Platform**: Node.js LTS, Linux/macOS
**Project Type**: CLI tool
**Performance Goals**: Same as existing — synchronous subprocess calls, sub-second response
**Constraints**: No new runtime npm dependencies; azdo-cli is an external tool like gh
**Scale/Scope**: ~4 files changed/created; ~150 lines of new TypeScript

## Constitution Check

- [x] CLI-First: all changes exposed via existing commander.js commands; no new flags except where needed
- [x] TypeScript strict: all new code typed; no `any`
- [x] Single Responsibility: `azdoService.ts` handles azdo calls only; `gitService.ts` dispatch is minimal
- [x] npm Distribution: no new runtime dependencies added
- [x] Simplicity: thinnest dispatch possible in `gitService.ts`; no plugin system

## Project Structure

### Documentation (this feature)

```text
specs/005-azdo-remote-support/
├── spec.md
├── plan.md              (this file)
├── research.md
├── tasks.md             (created by tasks phase)
└── checklists/
    └── requirements.md
```

### Source Code Changes

```text
src/
├── config/
│   ├── azdoService.ts   ← NEW: azdo PR info + comment functions
│   └── githubService.ts ← unchanged
└── git/
    └── gitService.ts    ← MODIFIED: getPrInfo dispatches by remoteType

src/commands/
    └── getReady.ts      ← MODIFIED: azdo error message references gap doc

docs/
    └── azdo-gap.md      ← NEW: gap documentation

tests/unit/
    └── azdoService.test.ts  ← NEW: unit tests for azdo service
```

**Structure Decision**: Single project at repo root. No structural changes to directory layout.

## Key Design Decisions

### Decision 1: Dispatch in `gitService.getPrInfo`

**Chosen approach**: `getPrInfo(branch)` reads `remoteType` from config and calls either the existing gh invocation or the new `azdoService.getPrInfo(branch)`.

**Rationale**: Zero changes to command files; the dispatch is at the data boundary where provider differences are smallest.

**Alternatives considered**:
- New `remoteService.ts` dispatcher: more indirection, requires updating command imports.
- Dispatch in command files: violates FR-009 (commands must not contain remoteType conditionals).

### Decision 2: `PrInfo.checks` is `[]` for AzDO

**Chosen approach**: Return an empty array; do not add a new nullable field to `PrInfo`.

**Rationale**: `azdo pr status` returns no policy data. Empty array is a valid `PrCheck[]` and the existing formatChecks function already handles it gracefully (`"Checks: none"`).

**Alternatives considered**: Add a `checksAvailable: boolean` field — unnecessary complexity for v1.

### Decision 3: `get-ready` azdo path is error-only

**Chosen approach**: When `remoteType === "azdo"`, exit 1 with message pointing to `docs/azdo-gap.md`.

**Rationale**: azdo-cli has no work item listing; a partial implementation would be misleading.

**Alternatives considered**: Allow work item ID to be passed as a CLI arg — out of scope per spec.

### Decision 4: `azdo pr status` response handling

**Chosen approach**: Parse `pullRequests[0]` from the JSON output. If array is empty, return `null`. Map `status` field: `active` → `OPEN`, `completed` → `MERGED`, `abandoned` → `CLOSED`.

**Rationale**: Source-verified shape from azdo-cli v0.5.0 `mapPullRequest()` function.

**Alternatives considered**: Use first active PR if multiple exist — too complex for v1; return first element unconditionally.
