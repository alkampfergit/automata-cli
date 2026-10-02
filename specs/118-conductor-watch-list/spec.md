# Feature Specification: conductor watch list

**Branch**: `feature/118-conductor-watch-list` | **Issue**: #118 (part of epic #114)

## User Story

As the operator, I want to keep a list of issues and pull requests the conductor watches, so later conductor work
knows what to follow and `do-work` picks the same items up.

## Requirements

- FR-1: The list lives in `.automata/config.json` as `conductor.watch`, an array of issue/PR numbers.
- FR-2: `automata conductor add <id>` resolves `<id>` as an issue or a PR, refuses a closed/merged one, adds it to the
  list (no duplicates) and applies the discovery setting so `do-work` picks it up: `label` adds the label,
  `assignee` assigns `agentUser`. Adding an issue also adds its open linked PR(s) to the list.
- FR-3: `automata conductor remove <id>` removes the id from the list and touches nothing on GitHub.
- FR-4: `automata conductor list` prints each watched id with its kind, state and title.
- FR-5: At the start of every tick (after the lock is taken) closed issues and closed/merged PRs are dropped from the
  list; each removal is logged on stdout.
- FR-6: `docs/conductor.md`, CHANGELOG bullet.

## Assumptions

- [AUTO] `title-contains` discovery: chose to fail `add` with a clear message because a title cannot be applied to an existing item; nothing is added.
- [AUTO] Followed PRs: chose to add them to the list only, without a label/assignee, because `do-work` reaches a linked PR through its issue.
- [AUTO] Lookup failure while pruning: chose to keep the id and warn on stderr because a network error must not silently empty the list.
- [AUTO] Identity: chose not to require the conductor identity for `add`/`remove`/`list`, because they are operator tooling; the tick keeps its check.
- [AUTO] `remove` of an id not on the list: chose exit 1 with a message, so a typo is noticed.
- [AUTO] Config write: chose `readRawConfig` + `writeConfig` so prompt file references are not inlined.
- [AUTO] Unparseable entries in a hand-edited `conductor.watch`: chose to drop non-positive-integers and duplicates when read.
