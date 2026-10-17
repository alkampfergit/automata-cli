# Research

## Decision: stories live in a `stories` list of the watch file
**Rationale**: Machine state already has a gitignored file; a story needs no reply logic and must not be pruned as an item.
**Alternatives considered**: Parent in `watch` with a flag (every reader of `watch` must learn the flag).

## Decision: children are read at each tick
**Rationale**: No stale copy; a person can add or reorder children in GitHub.
**Alternatives considered**: Store the children at `add` (drifts from GitHub).

## Decision: the first open child decides, never skip
**Rationale**: Strict order and one child at a time, as the issue asks; a blocked child stops the story.
**Alternatives considered**: Skip a blocked child (breaks order dependencies).

## Decision: pure `storyPlan` in `src/conductor/story.ts`
**Rationale**: The rules are testable with no `gh`; the command module only does I/O.
**Alternatives considered**: Logic inline in `conductor.ts` (already 800 lines).

## Decision: close the parent with `gh issue close --comment`
**Rationale**: One call, so the comment cannot repeat when the close fails.
**Alternatives considered**: Comment then close (a failed close repeats the comment at each tick).

## Autonomous Decisions
All decisions follow the issue discussion; see the spec Assumptions.
