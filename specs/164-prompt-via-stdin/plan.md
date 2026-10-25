# Plan: do-work passes the prompt on stdin

## Decisions

- Decision: one builder with a `promptOn` option, not a second builder. Rationale: two builders can drift, and the
  dry run must print the argv a real run uses. Alternatives considered: a prompt-less variant function.
- Decision: `feedStdin()` in `src/cli/spawnUtils.ts` writes with `end(text)` and swallows stdin errors. Rationale: the
  `close` handler already reports an early exit; a second rejection would settle twice. Alternatives considered:
  rejecting from the stdin error handler.
- Decision: the dry run prints `… < <tmp file>`. Rationale: the line stays pasteable and equal to the real command.
  Alternatives considered: printing argv and prompt as two blocks.
- Decision: remove the 96 KiB guard. Rationale: no new byte limit applies; the executor reports its own limit.
