# Feature Specification: Conductor story children

**Feature Branch**: `feature/153-conductor-story-children`
**Created**: 2026-10-17
**Status**: Draft
**Input**: Issue #153 — conductor: drive the child issues of a parent story one by one

## User Scenarios & Testing

### User Story 1 - Enrol a parent story (Priority: P1)

A maintainer runs `conductor add <parent>`. The conductor reads the children of the parent: the native sub-issues, or
the task list in the issue body when there are no sub-issues. The parent is stored as a story.

**Acceptance Scenarios**:
1. **Given** a parent with sub-issues, **When** `conductor add` runs, **Then** the parent is stored as a story and the
   output names the children and the first open one.
2. **Given** a parent with no sub-issues and a task list of `#N` items, **Then** the task list gives the children.
3. **Given** an issue with neither, **Then** it is watched as an ordinary issue, as before.

### User Story 2 - One child at a time (Priority: P1)

At each tick the conductor finds the first open child. If it has no open pull request and was not started yet, the
conductor applies the discovery label (or assignee) so `do-work` implements it. While that child has an open pull
request, or was started, the conductor waits. When the child is closed, the next child is the first open one.

### User Story 3 - Finish and stop (Priority: P2)

When all children are closed, the conductor comments on the parent, closes it and drops it from the stories. If the
first open child, or its open pull request, has the `conductor-blocked` label, the story stops and the conductor does
nothing on GitHub until a person removes the label.

### User Story 4 - See the state (Priority: P2)

`conductor list` shows each story with its children and their states. `conductor --check` reports which child is
next, which is waiting and which is blocked. A closed parent is pruned from the stories.

## Requirements

- **FR-001**: Stories are stored in `.automata/conductor-watch.json` under `stories`, apart from `watch`. The children
  are read at each tick and are never stored.
- **FR-002**: Children come from the sub-issues API; when it returns none, from `- [ ] #N` / `- [x] #N` items (and
  full URLs of this repository) in the parent body, in the order of the text.
- **FR-003**: Each child has one state: `closed`, `blocked`, `in review` (open pull request), `started` (discovery
  applied, no pull request), `next` (to be started), `queued` (after the first open child).
- **FR-004**: A tick applies the discovery setting only to a `next` child. The tick never runs a model for a story.
- **FR-005**: A blocked first open child stops the story silently. A pull request with the label blocks its child,
  and the conductor applies the label to the child too.
- **FR-006**: When all children are closed, one `gh issue close --comment` closes the parent; it is dropped from the stories.
- **FR-007**: `--dry-run` and `--check` change nothing. `--automatic` counts the stories as open items.
- **FR-008**: Documented in `docs/conductor.md`; entry in `CHANGELOG.md` under `Unreleased`.

## Assumptions

- [AUTO] Parallelism, blocked child and implementation: as the default decisions of the issue (one child, stop, label only).
- [AUTO] Storage: chose a `stories` key beside `watch` because the parent must not get conversation replies as a watched item.
- [AUTO] Children are not stored: reading them each tick keeps the story true when a person edits the parent.
- [AUTO] The parent is not given the discovery label: only its children are implemented.
- [AUTO] Sub-issues of other repositories are ignored: `do-work` works on this repository only.
- [AUTO] "Blocked" means the label `conductor-blocked` on the child or its open pull request; a person sets it, or the
  conductor does when a watched item stops.
- [AUTO] Discovery technique `title-contains` cannot be applied; `add` fails for a story as it does for an item.
- [AUTO] A story with zero children after enrolment is never completed: with no children, nothing is a story.

## Success Criteria

- A parent with three children is driven to closure one child at a time with no manual step after `conductor add`.
- A blocked child produces no comment and no label change after the first tick.
