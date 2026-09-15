# PR Report: Rescue survives an ignored run lock, and pre-flight failures are reported separately

**Branch**: `feature/034-rescue-ignored-lock`
**Date**: 2026-09-15
**Spec**: [specs/034-rescue-ignored-lock/spec.md](../../specs/034-rescue-ignored-lock/spec.md)

## Summary

In a checkout that adds `.automata/automata.lock` to its `.gitignore`, `do-work`'s pre-flight rescue
could not stage anything: naming an ignored path in a pathspec makes `git add` exit 1 even though it
staged everything correctly. The rescue therefore aborted, the working tree stayed dirty, and every
discovered issue was skipped as `dirty-tree`. This makes the rescue drop exclusions git already ignores,
stops it from leaving an empty recovery branch behind, and carries the pre-flight rescue and base-branch
failures onto the per-item skip lines so the two causes can be read apart.

## What's New

- **[FILLED IN PHASE 7]**

## Testing

- **[FILLED IN PHASE 7]**
