# Research: Execute Command (021)

**Branch**: `021-execute-command` | **Date**: 2026-04-03

## Codebase Analysis

### Existing `test` command (`src/commands/test.ts`)

Two subcommands: `test claude` and `test codex`.  
- Both require `--prompt <string>` (commander `requiredOption`)
- Both accept `--yolo`, `--verbose`
- `test claude` has `--opus/--sonnet/--haiku` shorthand flags resolved via `resolveModelOption()`
- Entry point: `testCommand` exported, registered in `src/index.ts`

### `claudeService.ts`

- `invokeClaudeCode(prompt, { yolo?, verbose?, model? })` — if `verbose` is set, uses async stream-json path; otherwise sync.
- `resolveModelOption()` — converts shorthand flags to model ID strings.
- `invokeClaudeCodeVerbose()` — streams JSON events, prints step-by-step to stderr, final result to stdout.
- `invokeClaudeCodeSync()` — `spawnSync` with `stdio: "inherit"`.
- Always passes `--dangerously-skip-permissions` when `yolo: true`.

### `codexService.ts`

- `invokeCodexCode(prompt, { yolo?, verbose? })` — only sync mode; `--verbose` prints a warning.
- Calls `codex exec [--dangerously-bypass-approvals-and-sandbox] <prompt>`.
- No model flag support today.

### `executePrompt.ts`

- Uses `addAiOptions()` helper: adds `--codex`, `--verbose`, `--push`, `--opus/--sonnet/--haiku`.
- Passes `yolo: true` unconditionally to both executors.
- **Out of scope for this feature** — must remain untouched.

### `src/index.ts`

Registers: `configCommand`, `gitCommand`, `implementNextCommand`, `testCommand`, `executePromptCommand`.

### Stdin in Node.js

Reading stdin before `program.parse()` in index.ts is tricky because it blocks. The cleanest approach for a CLI is to pre-read stdin inside the action handler asynchronously via `process.stdin` readable events, guarded by `!process.stdin.isTTY`. This is the same approach used in tools like `prettier --stdin-filepath`.

The action handler for `execute` can be `async` (commander supports this). Reading stdin inside the action via a Promise wrapper is the standard pattern.

## Decisions

| # | Decision | Rationale | Alternatives Considered |
|---|----------|-----------|------------------------|
| D1 | New file `src/commands/execute.ts` for the execute command | Single Responsibility — keeps the new command isolated from existing command files | Modifying test.ts in-place; rejected because user wants test removed entirely |
| D2 | Delete `src/commands/test.ts` and deregister from index.ts | User explicitly requested removal | Deprecation/aliasing; rejected as unnecessary complexity |
| D3 | Verbose (non-silent) is the DEFAULT; `--silent` suppresses | User requirement: "verbose is on by default, --silent outputs only summary" | Keeping current default (non-verbose); contradicts spec |
| D4 | Invoke `claudeService.invokeClaudeCode` with `yolo: true` and `verbose: !silent` | Re-uses existing infrastructure; verbose path already implements stream-json output | Duplicating invocation logic; rejected — DRY |
| D5 | Add `--model` to `codexService.invokeCodexCode` | Codex CLI supports `--model`; must be forwarded | Ignoring model for codex; rejected — user specified both executors need model |
| D6 | Stdin read helper function in `execute.ts` (not in index.ts) | Keeps index.ts unchanged except import swap | Reading in index.ts; rejected — couples stdin to all commands |
| D7 | `--with` as a non-optional option validated manually in action | Commander does not have built-in enum validation for options; manual check is the established pattern here | Using commander argument instead of option; rejected — user's examples use `--with` flag |

## Autonomous Decisions

- [AUTO] Stdin reading: async Promise wrapper inside action handler using `process.stdin` events guarded by `!process.stdin.isTTY`. Rationale: avoids blocking index.ts; consistent with async action handlers in commander.
- [AUTO] `--file-prompt` + piped stdin: `--file-prompt` wins (no error). Only `--prompt` combined with another source triggers the mutual exclusivity error. Rationale: simplest UX — explicit file flag beats passive pipe.
- [AUTO] Codex `--model` forwarding: add `model?: string` to `InvokeCodexOptions` and pass `--model <value>` before the prompt in args. Rationale: aligns with Codex CLI interface.
