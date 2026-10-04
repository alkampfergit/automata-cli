# PR Report: conductor runs the model and posts the reply

**Branch**: `feature/121-conductor-run-model`
**Date**: 2026-10-04
**Spec**: specs/121-conductor-run-model/spec.md

## Summary

The conductor tick now answers a watched issue or pull request that waits for an allowed user. It runs Claude or Codex
read-only, and the model posts the reply as a comment. The tick detects a run that posted nothing and exits 1.

## What's New

- **Read-only runs**: `readOnly` option for the Claude and Codex argv builders and runners.
- **Config**: `conductor.executor`, `conductor.models`, `conductor.effort`, with `config set conductor-executor|conductor-model|conductor-effort`.
- **Tick**: reads each watched item, applies the reply rule, runs the model, then checks that a comment appeared.
- **Prompt**: a posting instruction (`--body-file -`) is appended to every conductor prompt.
- **Docs**: `docs/conductor.md`, `docs/config.md`, `CHANGELOG.md`.

## Testing

- **Unit**: argv builders, execution settings, posted-nothing detection, the tick (claude, codex, no post, failed run, no reply owed), `config set`.
- `npm test && npm run lint` pass.

## Notes

- Codex's read-only sandbox may block the network, so `gh` cannot post; the tick reports it as a run that posted nothing.
- A run that posted nothing is retried on the next tick; loop safety is #122. No wizard screens for the new keys.

Closes #121
