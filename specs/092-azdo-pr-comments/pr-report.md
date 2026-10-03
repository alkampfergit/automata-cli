# PR Report: Azure DevOps unresolved PR threads

**Branch**: `feature/092-azdo-pr-comments`
**Date**: 2026-10-03
**Spec**: specs/092-azdo-pr-comments/spec.md

## Summary

`automata git get-pr-comments` no longer fails in Azure DevOps mode: it lists the unresolved, file-anchored review threads of the branch's PR in the same shape as GitHub mode. `execute-prompt fix-comments` works in azdo mode as a consequence.

## What's New

- **`azdoService.getPrComments`**: finds the active PR of the branch, reads its threads with `azdo pr comments`, keeps `active`/`pending` file threads and maps them to `PrComment`.
- **`gitService.getPrComments`**: delegates to it in azdo mode; the `"unsupported"` outcome and its handling in both commands are removed.
- **Docs and changelog**: the "GitHub only" notes are gone; `docs/git.md` documents the azdo mode.

## Testing

- **Unit**: fixture-based tests for resolved, active, pending, system and general threads, the PR lookup, and error propagation; command-level tests for the azdo path.
- **Suite**: `npm test && npm run lint` pass.

## Notes

- The author is a display name (azdo-cli 0.20.0 has no unique login) and is for display only.
- Fixtures are hand-written from azdo-cli's output shape; no live tenant was used.
