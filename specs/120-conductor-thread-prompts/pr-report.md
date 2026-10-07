# PR Report: conductor thread assembly and prompts

**Branch**: `feature/120-conductor-thread-prompts`
**Date**: 2026-10-04
**Spec**: specs/120-conductor-thread-prompts/spec.md

## Summary

Adds the thread the conductor gives the model: the issue, its pull requests, the review comments and the CI status.
Adds the config keys `conductor.prompts.issue` and `conductor.prompts.pr`, with defaults.

## What's New

- **Thread assembly** (`src/conductor/thread.ts`) and `getPrChecks` for the CI status.
- **Config**: `conductor.prompts.issue` and `conductor.prompts.pr`, resolved like `doWork.prompts`, with defaults.
- **Setting the keys**: `config set conductor-prompt` and two wizard screens.
- **Docs**: `docs/conductor.md`, `docs/config.md`, `CHANGELOG.md`.

## Testing

- **Unit**: thread content and filtering, check mapping, prompt resolution, the `config set` command, the wizard.
- `npm test && npm run lint` pass.

## Notes

The tick does not call the thread assembly yet. Later conductor issues do that.

Closes #120
