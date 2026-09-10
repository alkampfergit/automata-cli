# PR Report: Choose the executor and model from the triggering message

**Branch**: `feature/032-message-tool-model`
**Date**: 2026-09-10
**Spec**: [specs/032-message-tool-model/spec.md](spec.md)

## Summary

`do-work` now reads `tool:claude` / `tool:codex` and `model:<id>` out of the newest authorized
message that triggers a turn, and runs that turn with them. A maintainer can steer one turn
to a different executor or model from the text of their comment — no config change, no CLI
flag, no access to the harness machine — and the choice applies to that turn only, because
every tick re-reads whatever message is newest then.

## What's New

- [To be completed in Phase 7]

## Testing

- [To be completed in Phase 7]
