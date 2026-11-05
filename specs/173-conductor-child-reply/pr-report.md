# The conductor answers a child that has a discussion

**Branch**: `feature/173-conductor-child-reply` · **Spec**: `specs/173-conductor-child-reply/spec.md`

## Summary

Before the conductor starts a story child, it reads the thread of the child. When the agent spoke last, a model run
answers as the conductor user, and then `do-work` continues. The fixed "please implement it" comment is posted only for
a child with no comment.

## What's New

- Start step: no comment → start comment + label; allowed account last → waits; agent last → model reply, then label.
- `conductor.prompts.child` (and `config set conductor-prompt child`) with a built-in default.
- `NEEDS-HUMAN: <question>` posts nothing, applies no label, and prints the question.
- `--dry-run` runs the model for the agent-last case.

## Testing

- Unit: `childStart.test.ts` (classification); `conductor.cmd.test.ts` (waiting, reply + label, needs-user, failed run, dry run).
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run sonar:local` pass.

## Notes

- The marker is the existing `NEEDS-HUMAN:` last line, not a new `NEEDS_USER:` first line.
- As agreed, a child whose newest comment is from an allowed account gets no label, so it waits until a person acts.
- If the label fails after the reply is posted, the child shows "waiting for the agent" on the next tick.
