## Summary
When Claude Code loses its login, `do-work` now says so, blocks the tick and tells the user to run `claude /login`. Before, the run was reported as a generic failure and the redaction pass failed the same way.

## What's New
- `src/run/claudeAuth.ts`: extendable detection patterns (including the message from the issue), the comment text and its marker.
- `do-work`: a failed Claude run with an auth failure is classified `claude-auth`, blocks the tick (exit 2), skips the remaining items, and starts no redaction or recovery pass.
- The comment is posted once (marker `<!-- automata:claude-auth -->`); the tick note `claude-auth` shows the problem in `--check`.
- Docs: `docs/do-work.md`; `CHANGELOG.md` under Unreleased.

## Testing
- Unit tests for the detector and the comment; command tests for the blocked tick, no second pass, and the post-once rule. `npm test` and `npm run lint` pass.

## Notes
- No pre-flight check (decided on the issue). Detection needs `doWork.postRunLog` (default on).

Closes #140
