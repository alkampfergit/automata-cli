# Plan

- `src/conductor/story.ts` (pure): `parseTaskList`, `childStatus`, `planStory`, `describeStory`.
- `src/conductor/watchStore.ts`: `readStories`/`writeStories`; `writeWatch` keeps `stories`.
- `src/conductor/watchList.ts`: reuse `normalizeWatch` for `stories`.
- `src/github/ghWorkService.ts`: `getStorySource`, `closeIssue`; `WatchTarget` gets `assignees` and `body`.
- `src/commands/conductor.ts`: story branch in `add`, `list`, tick, dry run, `--check`, prune.
- `src/conductor/checkReport.ts`: a Stories section.
- Tests per module; `docs/conductor.md`; `CHANGELOG.md`.
