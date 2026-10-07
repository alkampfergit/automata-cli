# PR Report: `automata conductor` skeleton

**Branch**: `feature/117-conductor-skeleton`
**Date**: 2026-10-02
**Spec**: specs/117-conductor-skeleton/spec.md

## Summary

Adds `automata conductor`, one cron-friendly tick of the conductor role (epic #114). It loads the same configuration as
`do-work`, refuses to run unless `gh` is an allowed user who is not the agent, and takes its own run lock so it can run
next to `do-work`. It does no conductor work yet.

## What's New

- **`automata conductor`** (`src/commands/conductor.ts`): config, identity check, lock, exit 0/1/2.
- **Identity** (`src/github/identity.ts`): `conductorIdentityProblemFor`.
- **Lock** (`src/run/runLock.ts`): `acquireConductorLock` on `.automata/conductor.lock`, added to `AUTOMATA_OWN_PATHS`.
- **Docs**: `docs/conductor.md`, README section, CHANGELOG bullet.

## Testing

- **Unit**: identity verdicts, independent conductor/do-work locks, second conductor turned away.
- **Command**: allowed user, agent, non-allowed, unverifiable identity, missing config, azdo, held and suspect lock.
- `npm test && npm run lint` pass.

## Notes

- The tick does nothing after the pre-flight; the work arrives with later issues of #114.
