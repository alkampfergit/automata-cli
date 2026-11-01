# Conductor Copilot review rounds

**Branch**: `feature/172-conductor-copilot-review` | **Date**: 2026-11-01 | **Spec**: [spec.md](specs/172-conductor-copilot-review/spec.md)

Closes #172

## Summary

The conductor can ask Copilot for a number of review rounds on a pull request, wait for each one, and hold back the `conductor-ready` label until the rounds end. The number is set with `automata conductor config`, for one item or globally.
