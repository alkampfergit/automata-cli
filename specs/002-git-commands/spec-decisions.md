# Spec Decisions: Git Workflow Commands

**Branch**: `002-git-commands`
**Date**: 2026-03-30
**Spec**: [specs/002-git-commands/spec.md](./spec.md)
**Plan**: [specs/002-git-commands/plan.md](./plan.md)
**Research**: [specs/002-git-commands/research.md](./research.md)

## Planning Decisions

- **Subprocess invocation**: Use `spawnSync` from `node:child_process`. **Rationale**: Gives explicit exit code access without throwing on non-zero exit, requires no new dependencies. **Alternatives considered**: `execa` (adds a runtime dependency — rejected per Constitution IV); `execSync` (exception-based error flow makes handling non-zero exits awkward — rejected).

- **PR detection mechanism**: Use `gh pr view --json number,title,state,url` with no branch argument. **Rationale**: `gh` auto-detects the current branch, handles auth and API calls, and returns structured JSON. **Alternatives considered**: Raw GitHub REST API (requires token management and additional code — rejected per Constitution V); `gh pr list --head <branch>` (works but `gh pr view` is more direct for single-PR queries — rejected).

- **Upstream branch detection**: Use `git ls-remote --exit-code --heads origin <branch>` (exit code 2 = ref not found). **Rationale**: Queries the remote in real-time, avoiding stale local tracking ref state. Exit code 2 is documented. **Alternatives considered**: Parsing `git branch -vv` output (fragile, localized strings — rejected); `git remote show origin` (much heavier output to parse — rejected).

- **Module structure**: `src/commands/git.ts` (command group) + `src/git/gitService.ts` (service functions). **Rationale**: Mirrors the existing `src/commands/config.ts` + `src/config/configStore.ts` pattern. Service layer enables unit testing via `vi.mock` without spawning real processes. **Alternatives considered**: Inline all logic in command file (harder to test — rejected); one file per command (over-engineering for two related commands — rejected).

- **Merged-only precondition for `finish-feature`**: Only PRs with state `merged` qualify; `closed` (without merge) does not. **Rationale**: A closed-without-merge PR may represent a rejected or abandoned branch that the user intends to keep. **Alternatives considered**: Accept any non-open PR state (risks accidental deletion of unmerged branches — rejected).
