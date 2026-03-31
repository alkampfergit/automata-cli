# PR Report: Azure DevOps Remote Support

**Branch**: `005-azdo-remote-support`
**Date**: 2026-03-31
**Spec**: [specs/005-azdo-remote-support/spec.md](spec.md)

## Summary

Adds Azure DevOps as a supported remote type so `automata git get-pr-info` and `automata git finish-feature` work when `remoteType` is set to `azdo`. Uses the `azdo-cli` npm tool (v0.5.0) for PR queries. Capabilities not reachable via azdo-cli are documented in a new `docs/azdo-gap.md` file.

## What's New

<!-- Completed during Phase 7 — Finalise PR Artifacts -->
- **`src/config/azdoService.ts`**: [placeholder]
- **`src/git/gitService.ts` dispatch**: [placeholder]
- **`src/commands/getReady.ts` error message**: [placeholder]
- **`docs/azdo-gap.md`**: [placeholder]

## Testing

<!-- Completed during Phase 7 — Finalise PR Artifacts -->
- [placeholder]

## Notes

<!-- Completed during Phase 7 — Finalise PR Artifacts -->
- [placeholder]
