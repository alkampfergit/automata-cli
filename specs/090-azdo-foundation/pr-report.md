# Azure DevOps foundation

**Branch**: `feature/090-azdo-foundation` | **Date**: 2026-09-30 | **Spec**: [spec.md](./spec.md)

## Summary
Adds one backend selector, Azure DevOps origin URL parsing and an `azdo` prerequisite check, and rewrites the gap
document for azdo-cli 0.20.0. No command gains new behaviour yet.

## What's New
- `src/remote/backend.ts`: `selectBackend`, `isAzdo`, `isExplicitGitHub`, `azdoUnsupportedMessage`; existing checks route through it.
- `src/remote/originUrl.ts`: https, visualstudio.com and ssh Azure DevOps URLs, plus GitHub.
- `src/remote/azdoPrerequisites.ts`: PATH, version ≥ 0.20.0, authenticated identity, `--no-update-check`.
- `docs/azdo-gap.md` rewritten as a gh→azdo mapping table.

## Testing
Unit tests for the selector, origin parsing and prerequisite check; `npm test && npm run lint` green.

Closes #90
