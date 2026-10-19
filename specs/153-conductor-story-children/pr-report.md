# PR Report: Conductor story children

**Branch**: `feature/153-conductor-story-children`
**Date**: 2026-10-17
**Spec**: specs/153-conductor-story-children/spec.md

## Summary

The conductor can now drive a parent story: `conductor add <parent>` stores the parent as a story, and each tick starts
the first open child that has no pull request, one child at a time. When all children are closed, the conductor closes
the parent.

## What's New

- **Story rules** (`src/conductor/story.ts`): pure task-list parser, child states and the plan of a tick.
- **Story I/O** (`src/conductor/storyRunner.ts`): reads a story, starts the next child, closes a finished parent, and feeds `list`, `--check` and `--dry-run`.
- **Storage** (`watchStore.ts`): a `stories` list in `.automata/conductor-watch.json`; `writeWatch` keeps it.
- **GitHub reads** (`ghWorkService.ts`): `getStorySource` (sub-issues API, task list as fallback) and `closeIssue`.
- **Command** (`conductor.ts`): `add` enrols a parent with children as a story; the tick, `list`, `remove` and `--check` know stories.
- **Docs**: a Stories section in `docs/conductor.md`; entry in `CHANGELOG.md`.

## Testing

- **Unit**: story rules and task-list parsing (`story.test.ts`); `gh` reads (`ghWorkService.test.ts`); the tick, `add`, `remove`, `list`, `--check` and `--dry-run` with mocks (`conductor.cmd.test.ts`); the report section (`conductorCheckReport.test.ts`).
- `npm test` (1894 tests) and `npm run lint` pass.

## Notes

- A label on the pull request of a child does not block the story; the story already waits for that pull request.
- Not run against a live GitHub repository.
