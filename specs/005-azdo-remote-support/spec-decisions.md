# Spec Decisions: Azure DevOps Remote Support

**Branch**: `005-azdo-remote-support`
**Date**: 2026-03-31
**Spec**: [specs/005-azdo-remote-support/spec.md](spec.md)
**Plan**: [specs/005-azdo-remote-support/plan.md](plan.md)
**Research**: [specs/005-azdo-remote-support/research.md](research.md)

## Planning Decisions

- **Dispatch location — `gitService.getPrInfo`**: `getPrInfo(branch)` reads `remoteType` from config and calls `azdoService.getPrInfo` or the existing gh path. **Rationale**: Zero changes to command files; dispatch is at the single data boundary where provider differences are smallest. **Alternatives considered**: New `remoteService.ts` dispatcher (more indirection, required changing command imports); dispatch in command files (violates FR-009).

- **`PrInfo.checks` is `[]` for AzDO**: Return an empty array rather than adding a nullable field. **Rationale**: `azdo pr status` returns no policy data; the existing `formatChecks` function already handles empty arrays with `"Checks: none"`. **Alternatives considered**: `checksAvailable: boolean` field — unnecessary complexity for v1.

- **`get-ready` azdo path is error-only**: When `remoteType === "azdo"`, exit 1 with a message pointing to `docs/azdo-gap.md`. **Rationale**: azdo-cli has no work item listing; partial implementation would mislead users. **Alternatives considered**: Accept work item ID as CLI arg — deferred as out of scope.

- **AzDO PR status mapping**: `status` field values `active → OPEN`, `completed → MERGED`, `abandoned → CLOSED`. **Rationale**: Source-verified from azdo-cli v0.5.0 `mapPullRequest()` function; these are the only possible values in the AzDO REST API v7.1 pull request schema. **Alternatives considered**: No alternatives; mapping is deterministic.

- **azdo-cli as external tool, not npm dependency**: Invoked via `spawnSync` identical to `gh`; not added to `package.json`. **Rationale**: Consistent with how `gh` is handled; keeps bundle minimal (constitution Principle IV). **Alternatives considered**: Listed as optional peer dependency — unnecessary for a CLI tool.
