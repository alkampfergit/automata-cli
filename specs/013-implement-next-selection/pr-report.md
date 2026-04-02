# PR Report: implement-next Multi-Issue Selection

**Branch**: `013-implement-next-selection`
**Date**: 2026-04-02
**Spec**: [specs/013-implement-next-selection/spec.md](spec.md)

## Summary

This feature enhances `automata implement-next` to handle the case where multiple GitHub issues match the configured filter. Instead of silently picking the first one, the command now presents a numbered list and lets the user choose. Two new flags (`--take-first` and `--limit`) cover non-interactive and higher-capacity scenarios. The issue number is now always visible before AI invocation and embedded in the prompt sent to Claude or Codex.

## What's New

<!-- To be completed in Phase 7 after implementation -->

- **[Placeholder]**: [What was added or changed and why]

## Testing

<!-- To be completed in Phase 7 after implementation -->

- **[Placeholder]**: [What scenario was covered]
