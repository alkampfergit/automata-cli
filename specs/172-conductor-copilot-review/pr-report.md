# Conductor Copilot review rounds

**Branch**: `feature/172-conductor-copilot-review` | **Date**: 2026-11-01 | **Spec**: [spec.md](specs/172-conductor-copilot-review/spec.md)

Closes #172

## Summary

The conductor can ask Copilot for a number of review rounds on a pull request, wait for each one, and hold back the `conductor-ready` label until the rounds end. The number is set with `automata conductor config`, for one item or for all items. Nothing changes while the setting is absent.

## What's New

- **`conductor config`**: `[<id>|#<id>] set|get|unset|list`, driven by one key registry (`src/conductor/settings.ts`). `list` shows every key with ALLOWED, DEFAULT, VALUE and SOURCE. `copilot-review-type` (`balanced`, `lite`) is stored and marked "not supported yet" in `list`, help, docs and a `set` warning.
- **State file**: the gitignored `conductor-watch.json` also keeps `settings` and per-PR `copilotRounds`; every write keeps all sections. Read-only commands never create the file.
- **Round decision**: pure `decideCopilotRound` returns `off`, `wait`, `fix`, `request` or `done`. A tick requests the review with `addCopilotReviewer`, waits while Copilot is a pending reviewer, and a failed request ends the rounds for that PR with a warning.
- **Ready label**: `conductor-ready` also needs the rounds to be off or done.
- **`git request-copilot-review [<pr>]`**: standalone request, same call.
- **Docs**: `docs/conductor.md`, `docs/git.md`, `CHANGELOG.md`.

## Testing

- **Unit**: registry and resolution, round decision, state file sections, `config` command, `request-copilot-review`, ready gate.
- **Integration (mocked `gh`)**: conductor ticks for request, wait, issue-to-PR setting precedence, failed request, dry run.

## Notes

- `copilot-review-type` has no effect yet: `gh pr edit --add-reviewer @copilot` has no mode option.
- A review that stays pending holds the item until a person removes the request.
- The command is registered in `src/index.ts`, not `git.ts`, because `sonar:local` flags an old control-character regex in `git.ts` whenever that file changes.
