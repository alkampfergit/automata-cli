# Feature Specification: the conductor answers a child that has a discussion

**Branch**: `feature/173-conductor-child-reply` | **Issue**: #173

## User Story

As the operator, I want the conductor to read the thread of a child before it starts the child, so a child with a
long discussion gets a meaningful answer as the conductor user and not a fixed "please implement it" comment.

The loop is: conductor posts, `do-work` runs the agent, the agent answers, the conductor replies as the user.

## Requirements

- FR-1: For a story child in state `next` (no discovery setting yet), the start step reads the comments of the child.
  Only authorized accounts and the agent count. The issue body is not a message.
- FR-2: No comment: keep the start comment, then apply the discovery setting.
- FR-3: The newest comment is from an authorized account: do nothing and print `waiting for the agent`.
- FR-4: The newest comment is from the agent: run an AI turn (the `conductor.executor` option, as for every other
  conductor turn). The run gets the whole thread of the child and the parent story. It posts the reply as the conductor
  user, then the discovery setting is applied so `do-work` continues.
- FR-5: When the model ends with `NEEDS-HUMAN: <question>`, nothing is posted and no label is applied. The question is
  printed on stdout. The next tick checks the child again.
- FR-6: The prompt is `conductor.prompts.child` (text or `.md` file), with a built-in default. `config set
  conductor-prompt child <value>` sets it.
- FR-7: `--dry-run` runs the model for case FR-4 and prints the reply; it reports FR-2 and FR-3 as lines.
- FR-8: A child that already has the discovery setting stays with `do-work` and the ordinary conductor turn.
- FR-9: `docs/conductor.md`, `docs/config.md` and `CHANGELOG.md` describe the change.

## Assumptions

- [AUTO] The marker for "needs the user" is the existing `NEEDS-HUMAN:` last line, not a new `NEEDS_USER:` first line:
  the conductor prompt already tells the model to use it, so a second marker would conflict.
- [AUTO] The reply turn does not use the reply limit of an item: it runs once for a child, because the discovery
  setting that follows ends the start step for that child.
- [AUTO] The conductor-user-last case applies no label, as agreed on the issue. A child in that state waits until a
  person acts.
