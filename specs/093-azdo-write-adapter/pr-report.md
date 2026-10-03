# PR Report: Azure DevOps PR / work item write adapter

**Branch**: `feature/093-azdo-write-adapter`
**Date**: 2026-10-03
**Spec**: specs/093-azdo-write-adapter/spec.md

## Summary

Adds the Azure DevOps counterpart of the operations that finish a piece of work: link the PR to a work item, rewrite its description, add a reviewer, comment on the PR or work item, and assign the work item. Nothing calls it yet; the Phase C children of #89 will.

## What's New

- **`RemoteWriteService` + `selectWriteService`** (`src/remote/writeService.ts`): one interface, a GitHub wrapper over the existing functions, selection through `selectBackend`.
- **`azdoWriteService`** (`src/remote/azdoWriteService.ts`): the azdo implementation; PR bodies and PR comments go on stdin, `AB#<id>` is added to the description before `pr work-items link`.
- **`docs/azdo-gap.md`**: the mapping table and the decisions (PR claim is a no-op, work-item comments travel in argv).

## Testing

- **Unit**: stubbed `spawnSync` for every operation, including stdin delivery, the 4000/30000 character guards, idempotent linking and error propagation; selector tests.
- **Suite**: `npm test && npm run lint` pass.

## Notes

- `azdo comments add` has no file/stdin form in 0.20.0, so work-item comments are argv (no shell) and capped at 30000 characters.
- azdo-cli cannot show a PR by id, so linking finds the PR in `pr status`, then the first 200 active PRs.
- No CHANGELOG entry: nothing user-visible changes until a command calls the adapter. Fixtures are recorded-shape stubs; no live tenant was used.
