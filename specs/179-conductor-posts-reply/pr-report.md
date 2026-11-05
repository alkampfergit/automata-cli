# The conductor posts its own replies

**Branch**: `feature/179-conductor-posts-reply` · **Spec**: `specs/179-conductor-posts-reply/spec.md`

## Summary

The model run of the conductor only writes the reply. The conductor posts it with its own `gh` call, so a refused
`gh` permission in the run can no longer block a reply. Closes #179.

## What's New

- The conductor prompt asks for the reply text only; the run has no permission to comment.
- `postComment` posts the reply, with the reply, rebase or CI-fix marker added by the conductor.
- A run with no answer fails with `the model produced no answer`; `NEEDS-HUMAN:` is not posted.

## Testing

- Unit: `conductor.cmd.test.ts` (post, marker, no answer, failed post, needs-human), `conductorThread.test.ts`,
  `conductorLoopSafety.test.ts`, `ghWorkService.test.ts` (`postComment`).
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run sonar:local`.

## Notes

- `do-work` still asks its model to post; the issue owner limited this change to the conductor.
