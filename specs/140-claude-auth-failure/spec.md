# Spec: Claude login failure in do-work (#140)

When Claude Code loses its login, `do-work` must say so and tell the user how to fix it.

## Requirements
- Detect an authentication failure from the Claude output with an extendable pattern list; classify it `claude-auth`.
- Treat the tick as blocked with a clear reason; tell the user to run `claude /login`.
- Start no Claude-based redaction or recovery pass after the failure; show pattern-redacted output only.
- Show the problem in `--check`; post the issue comment once (marker `<!-- automata:claude-auth -->`).

## Assumptions
- [AUTO] Pre-flight check: none, as decided on the issue. Detection needs `doWork.postRunLog` (default on).
- [AUTO] The remaining items of the tick are skipped, because they would fail the same way.
