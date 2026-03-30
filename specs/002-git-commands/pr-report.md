# PR Report: Git Workflow Commands

**Branch**: `002-git-commands`
**Date**: 2026-03-30
**Spec**: [specs/002-git-commands/spec.md](./spec.md)

## Summary

This feature introduces a `git` subcommand group to automata-cli, exposing two commands that automate common GitHub-centric workflow steps. `automata git get-pr-info` surfaces the pull request linked to the current branch directly in the terminal, and `automata git finish-feature` performs the full post-merge cleanup (checkout develop, pull, delete local branch) as a single safe command with full precondition validation.

## What's New

- **`src/git/gitService.ts` (new)**: Service module wrapping all `git` and `gh` subprocess calls using `spawnSync`. Exports typed functions: `getCurrentBranch`, `getPrInfo`, `isUpstreamGone`, `hasUncommittedChanges`, `checkoutAndPull`, `deleteLocalBranch`. Also defines the `PrInfo` interface.
- **`src/commands/git.ts` (new)**: commander.js command group with two subcommands — `get-pr-info` (with `--json` flag) and `finish-feature`. All error output goes to stderr; success output to stdout. Exit codes are meaningful.
- **`src/index.ts` (modified)**: Registers the `gitCommand` alongside the existing `configCommand`.
- **`tests/unit/git.cmd.test.ts` (new)**: Unit tests covering `getCurrentBranch`, `getPrInfo`, `isUpstreamGone`, and `hasUncommittedChanges` via `vi.mock` on `node:child_process`, plus CLI smoke tests for help output.
- **`README.md` (updated)**: Documents both new commands with usage examples, output format, and precondition list for `finish-feature`.

## Testing

- **Unit (vi.mock)**: `gitService` functions are tested in isolation by mocking `spawnSync`. Covers success paths, "no PR found" path, and authentication error for `getPrInfo`; ref-found and ref-gone cases for `isUpstreamGone`; clean and dirty working tree for `hasUncommittedChanges`.
- **CLI smoke**: `automata git --help`, `get-pr-info --help`, and `finish-feature --help` are exercised against the built `dist/index.js` to verify command registration and flag presence.

## Notes

- `finish-feature` only proceeds if the PR state is `merged` — a PR closed without merging will abort the command to prevent accidental branch deletion.
- Both commands require the `gh` CLI to be installed and authenticated (`gh auth login`).
- `finish-feature` checks `git ls-remote` in real-time against the remote, so it requires network access.
