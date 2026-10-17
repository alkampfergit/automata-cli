# PR Report: Conductor story children

**Branch**: `feature/153-conductor-story-children`
**Date**: 2026-10-17
**Spec**: specs/153-conductor-story-children/spec.md

## Summary

The conductor can now drive a parent story: `conductor add <parent>` stores the parent as a story, and each tick starts
the first open child that has no pull request, one child at a time. When all children are closed, the conductor closes
the parent.

## What's New

- **Story rules**: pending.

## Testing

- pending.
