# PR Report: Azure DevOps Remote Support

**Branch**: `005-azdo-remote-support`
**Date**: 2026-03-31
**Spec**: [specs/005-azdo-remote-support/spec.md](spec.md)

## Summary

Adds Azure DevOps as a supported remote type so `automata git get-pr-info` and `automata git finish-feature` work when `remoteType` is set to `azdo`. Uses the `azdo-cli` npm tool (v0.5.0) for PR queries. Capabilities not reachable via azdo-cli are documented in a new `docs/azdo-gap.md` file.

## What's New

- **`src/config/azdoService.ts`** (new): Wraps `azdo pr status --json` and maps AzDO pull request status (`active` / `completed` / `abandoned`) to the shared `PrInfo` shape (`OPEN` / `MERGED` / `CLOSED`). Returns `null` when no PRs exist for the branch. Throws on ENOENT or non-zero exit with a clear error message.
- **`src/git/gitService.ts` — provider dispatch**: `getPrInfo(branch)` now reads `remoteType` from config and calls `azdoService.getPrInfo()` when set to `azdo`, preserving the existing GitHub path unchanged. All other git operations (checkout, pull, delete, fetch, upstream check) are provider-agnostic and untouched.
- **`src/commands/getReady.ts` — azdo error message**: Updated the unsupported-mode error to explain why azdo mode is unsupported and point users to `docs/azdo-gap.md`.
- **`docs/azdo-gap.md`** (new): Documents the two capability gaps — work item discovery (unavailable) and PR check/policy status (not returned by azdo-cli) — with rationale and a path to closing each gap in a future release.

## Testing

- **Unit — `tests/unit/azdoService.test.ts`** (new, 8 tests): Covers null return when no PRs, all three status mappings (active→OPEN, completed→MERGED, abandoned→CLOSED), empty checks array, ENOENT error, non-zero exit error, and correct CLI argument shape.
- **Unit — `tests/unit/git.commands.test.ts`** (extended, +2 tests): Verifies that `get-pr-info` calls `azdo pr status --json` when `remoteType` is `azdo`, and that `finish-feature` completes successfully when the azdo PR status is `completed`.
- **Unit — `tests/unit/getReady.cmd.test.ts`** (updated): Updated assertion to match new azdo error message including `docs/azdo-gap.md` reference.

## Notes

- `azdo pr status` does not return policy evaluation results; the `checks` array is always empty in AzDO mode. This is documented in `docs/azdo-gap.md`.
- azdo-cli is an external tool (like `gh`) that must be installed and authenticated by the user. It is not added to `package.json` dependencies.
