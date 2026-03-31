# Implementation Plan: Git Publish Release

**Branch**: `007-git-publish-release` | **Date**: 2026-03-31 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/007-git-publish-release/spec.md`

## Summary

Add a `automata git publish-release [version]` command that executes the full GitFlow release sequence: creates a `release/<version>` branch from `develop`, merges it into `master` with a tag, merges back into `develop`, deletes the release branch, and pushes `develop`, `master`, and the tag to `origin`. When no version is given, the command auto-detects the latest semver tag on `master` and increments the minor segment.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode), Node.js LTS
**Primary Dependencies**: commander.js (CLI framework), `node:child_process` `spawnSync` (existing pattern)
**Storage**: N/A — read-only git state queries + git write operations
**Testing**: vitest (unit tests using module mocking for `gitService`)
**Target Platform**: Linux/macOS CLI (Node.js)
**Project Type**: CLI tool
**Performance Goals**: Full release sequence completes in under 30 seconds on normal network
**Constraints**: No new runtime dependencies; shell out to `git` only (no `gh` needed for this command)
**Scale/Scope**: One new command, two files modified

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CLI-First Design | PASS | commander.js subcommand, POSIX stdout/stderr, exit codes |
| II. TypeScript Strictness | PASS | All types explicit, no `any` |
| III. Single Responsibility | PASS | Command does exactly one thing: publish a GitFlow release |
| IV. npm Distribution | PASS | No new runtime dependencies |
| V. Simplicity | PASS | Minimal functions added to existing service; no new abstractions |

No violations.

## Project Structure

### Documentation (this feature)

```text
specs/007-git-publish-release/
├── spec.md
├── plan.md             (this file)
├── research.md
├── tasks.md
├── pr-report.md
├── spec-decisions.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
src/
├── commands/
│   └── git.ts          # add publishReleaseCmd, wire into gitCommand
└── git/
    └── gitService.ts   # add getLatestTagOnMaster, bumpMinorVersion, publishRelease

tests/
└── unit/
    ├── publishRelease.test.ts       # new: service-function unit tests
    └── git.commands.test.ts         # extended: CLI precondition tests for publish-release
```

**Structure Decision**: Single-project, flat service layer. Mirrors existing `finish-feature` pattern exactly.

## Phase 1: Design

### API — new service functions in `gitService.ts`

```typescript
// Returns the bare version string (e.g. "1.2.0") of the latest semver tag on master.
// Returns null if no semver tag is found.
export function getLatestTagOnMaster(): string | null

// Bumps the minor segment and resets patch to 0.
// Input: "1.2.5" → Output: "1.3.0"
export function bumpMinorVersion(version: string): string

// Returns true if a git tag with the given name already exists locally.
export function tagExists(version: string): boolean

// Executes the full GitFlow release sequence.
// If dryRun is true, prints each command to stdout without executing.
export function publishRelease(version: string, dryRun: boolean): void
```

### Command wiring in `git.ts`

```
automata git publish-release [version]
  [version]   Optional semver X.Y.Z. Auto-detected from master tag if omitted.
  --dry-run   Print git commands without executing them.
```

### GitFlow sequence (in `publishRelease`)

1. `git checkout -b release/<version>`
2. `git checkout master`
3. `git merge --no-ff release/<version>`
4. `git tag <version>`
5. `git checkout develop`
6. `git merge --no-ff release/<version>`
7. `git branch -d release/<version>`
8. `git push origin develop master <version>`

Each step uses the existing `run()` helper. On non-zero exit, throw with the stderr message.

## Phase 2: Pre-conditions checked in `git.ts` before calling `publishRelease`

1. Working tree is clean (`hasUncommittedChanges`)
2. Current branch is `develop` (`getCurrentBranch`)
3. Version matches `/^\d+\.\d+\.\d+$/`
4. Tag does not already exist (`tagExists`)
