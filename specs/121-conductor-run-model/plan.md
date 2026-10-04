# Plan: conductor runs the model and posts the reply

- `src/claude/claudeService.ts`, `src/codex/codexService.ts`: `readOnly` option in the argv builders and in `runClaude`/`runCodex`.
- `src/conductor/execution.ts` (pure): validate and resolve executor, model and effort.
- `src/conductor/thread.ts`: `ReplyTarget`, `postingInstruction`, appended to every prompt.
- `src/conductor/reply.ts` (pure core): `newMessagesBy`, `conductReply` (read, run, read, compare).
- `src/commands/conductor.ts`: the tick reads each item, decides, runs and verifies; `runConductor` is now async.
- `src/commands/config.ts`: three `config set` subcommands. `src/config/configStore.ts`: new keys.
- Docs: `docs/conductor.md`, `docs/config.md`, `CHANGELOG.md`.
- Tests: `conductorReply`, `conductorThread`, `conductor.cmd`, `claudeService`, `codexService`, `config.cmd`.
