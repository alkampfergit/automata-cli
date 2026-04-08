# Implementation Plan: Execute Command

**Branch**: `021-execute-command` | **Date**: 2026-04-03 | **Spec**: specs/021-execute-command/spec.md  
**Input**: Feature specification from `specs/021-execute-command/spec.md`

## Summary

Replace the experimental `test claude` / `test codex` subcommands with a production-grade top-level `execute` command. The command accepts a prompt from `--prompt`, `--file-prompt`, or stdin; requires `--with claude|codex`; runs always-unattended; defaults to verbose output; and supports `--silent` and `--model`.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode), Node.js LTS 18+  
**Primary Dependencies**: commander.js (existing), node:child_process (existing), node:fs (existing)  
**Storage**: N/A  
**Testing**: vitest (existing)  
**Target Platform**: CLI — Linux/macOS/Windows  
**Project Type**: CLI tool  
**Performance Goals**: N/A  
**Constraints**: No new runtime dependencies  
**Scale/Scope**: Small — ~150 lines of new code, ~30 lines deleted

## Constitution Check

- ✅ CLI-First: exposed as a commander.js top-level command
- ✅ TypeScript strict: no `any`, explicit types on all exports
- ✅ Single Responsibility: one command, one file
- ✅ POSIX conventions: stdin/args for input, stdout for output, stderr for errors, non-zero exit on failure
- ✅ No new dependencies added

## Project Structure

### Documentation (this feature)

```text
specs/021-execute-command/
├── spec.md
├── research.md
├── plan.md          ← this file
└── tasks.md         ← Phase 4
```

### Source Code Changes

```text
src/
├── commands/
│   ├── execute.ts        ← NEW  (replaces test.ts)
│   └── test.ts           ← DELETE
├── codex/
│   └── codexService.ts   ← MODIFY (add model support)
└── index.ts              ← MODIFY (swap test → execute)

docs/
└── execute.md            ← NEW (replaces test docs if any)
```

**Structure Decision**: Single project — standard `src/` layout. Minimal changes: one new file, one deleted file, two small modifications.

## Design

### `src/commands/execute.ts`

```typescript
export const executeCommand = new Command("execute")
  .description("Delegate work to an AI executor (Claude or Codex)")
  .requiredOption("--with <executor>", "Executor to use: claude or codex")
  .option("--prompt <string>", "Prompt to send to the executor")
  .option("--file-prompt <path>", "Path to a file whose content is used as the prompt")
  .option("--silent", "Suppress step-by-step output; show only final summary")
  .option("--model <string>", "Model identifier to pass to the executor")
  .action(async (options) => { ... });
```

**Prompt resolution order** (inside action handler):
1. If `--prompt` → use it directly.
2. Else if `--file-prompt` → read file synchronously.
3. Else if `!process.stdin.isTTY` → read stdin asynchronously.
4. Else → error: no prompt provided.

**Mutual exclusivity**: if `--prompt` is set AND (`--file-prompt` is set OR stdin is piped), exit 1.

### `src/codex/codexService.ts` changes

Add `model?: string` to `InvokeCodexOptions`. In `invokeCodexCodeSync`, insert `--model <value>` before the prompt argument when set.

### `src/index.ts` changes

Remove `import { testCommand }` and `program.addCommand(testCommand)`.  
Add `import { executeCommand }` and `program.addCommand(executeCommand)`.
