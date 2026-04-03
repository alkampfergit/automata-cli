# Spec Decisions: Execute Command

**Branch**: `021-execute-command`
**Date**: 2026-04-03
**Spec**: specs/021-execute-command/spec.md
**Plan**: specs/021-execute-command/plan.md
**Research**: specs/021-execute-command/research.md

## Planning Decisions

- **New file vs modifying test.ts**: Created `src/commands/execute.ts` as a new file and deleted `test.ts`. **Rationale**: The user requested complete removal of `test`; starting fresh keeps the implementation clean and avoids dead code. **Alternatives considered**: In-place rename/rewrite of `test.ts`; rejected as it would leave confusing git history and risk scope creep from residual `--yolo`/`--verbose` semantics.

- **Verbose by default / --silent to suppress**: Inverted the verbosity model compared to the original `test` command. **Rationale**: User explicitly stated "verbose is on by default"; this is more user-friendly for interactive use and CI alike. **Alternatives considered**: Keeping `--verbose` opt-in; contradicts the spec requirement.

- **--with as a required option (not a positional argument)**: Implemented as `--with <executor>`. **Rationale**: User's provided examples all use `--with`; option flags are more self-documenting than positional args. **Alternatives considered**: `automata execute claude --prompt ...` (positional); rejected — contradicts user examples.

- **Stdin reading inside action handler**: Stdin is read asynchronously inside the async action handler, not in index.ts. **Rationale**: Keeps index.ts clean; only the execute command needs stdin; action handlers can be async in commander. **Alternatives considered**: Pre-reading stdin in index.ts before `program.parse()`; rejected — would affect all commands and complicate the main entry point.

- **No new runtime dependencies**: All prompt-source reading (file, stdin) uses Node.js built-ins (`fs`, `process.stdin`). **Rationale**: Matches constitution IV (minimal runtime dependencies). **Alternatives considered**: Using a streaming library; rejected — unnecessary complexity for a synchronous/async read of a string.

- **codexService model forwarding**: Added `model?: string` to `InvokeCodexOptions` and insert `--model <value>` before the prompt argument in `codex exec` args. **Rationale**: Codex CLI supports `--model`; the flag must precede the prompt argument per CLI conventions. **Alternatives considered**: Environment variable; rejected — CLI flag is explicit and portable.
