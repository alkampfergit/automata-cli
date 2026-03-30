# PR Report: Git Workflow Commands

**Branch**: `002-git-commands`
**Date**: 2026-03-30
**Spec**: [specs/002-git-commands/spec.md](./spec.md)

## Summary

This feature introduces a `git` subcommand group to automata-cli, exposing two commands that automate common GitHub-centric workflow steps. `automata git get-pr-info` surfaces the pull request linked to the current branch directly in the terminal, and `automata git finish-feature` performs the full post-merge cleanup (checkout develop, pull, delete local branch) as a single safe command.

## What's New

<!-- Filled in Phase 7 after implementation -->
- **`src/commands/git.ts`**: [placeholder]
- **`src/git/gitService.ts`**: [placeholder]
- **`src/index.ts`**: [placeholder]

## Testing

<!-- Filled in Phase 7 after implementation -->
- **Unit**: [placeholder]

## Notes

- `finish-feature` only proceeds if the PR state is `merged` — a PR closed without merging will abort the command to prevent accidental branch deletion.
- Both commands require the `gh` CLI to be installed and authenticated.
