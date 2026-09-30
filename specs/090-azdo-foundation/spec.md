# Feature Specification: Azure DevOps foundation

**Branch**: `feature/090-azdo-foundation` | **Issue**: #90 (part of #89)

## User Story 1 — One backend selector (P1)
The remote type is decided in one module (`src/remote/backend.ts`); commands and `gitService` ask it instead of
comparing `remoteType` themselves. GitHub behaviour and existing tests are unchanged.

## User Story 2 — Azure DevOps origin parsing (P1)
`src/remote/originUrl.ts` parses `dev.azure.com` https, `*.visualstudio.com` and `ssh.dev.azure.com:v3` URLs into
organization/project/repo, and GitHub https/ssh URLs into owner/repo.

## User Story 3 — Prerequisite check (P2)
`checkAzdoPrerequisites()` verifies `azdo` on PATH, version ≥ 0.20.0, and an authenticated identity, passing
`--no-update-check` on every call.

## User Story 4 — Accurate gap document (P2)
`docs/azdo-gap.md` describes azdo-cli 0.20.0 as a gh→azdo mapping table.

## Requirements
- FR-001 single selector; absent `remoteType` is GitHub except where a command already demands an explicit `gh`.
- FR-002 pure parsing, no I/O. FR-003 injectable runner for the prerequisite check.
- FR-004 existing "not supported" messages keep their wording and link `docs/azdo-gap.md`.

## Assumptions
- [AUTO] Wiring: chose to add the modules and route existing `remoteType` checks through them, without enabling new
  azdo commands, because those are the sibling child issues.
- [AUTO] Prerequisite check is not yet called by a command: its consumers arrive in later children.
- [AUTO] `identity` may be a string or an object; display name is preferred when an object.
- [AUTO] No CHANGELOG bullet: nothing user-visible changes yet.
