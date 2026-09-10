# PR Report: `--effort` on every AI-invoking command

**Branch**: `feature/032-ai-effort`
**Date**: 2026-09-10
**Spec**: [specs/032-effort-option-all/spec.md](spec.md)

## Summary

Both executors automata can drive expose a reasoning-effort control, and until now automata offered no way to reach it.
This adds `--effort <level>` to every command that invokes an executor, and a configured default for the unattended
`do-work` loop under `doWork.effort`, keyed per executor exactly as `doWork.models` already is.

## What's New

*(completed in Phase 7)*

## Testing

*(completed in Phase 7)*
