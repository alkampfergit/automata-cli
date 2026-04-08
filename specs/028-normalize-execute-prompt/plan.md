# Implementation Plan: Normalize Execute-Prompt Parameters

**Branch**: `feature/028-normalize-execute-prompt` | **Date**: 2026-04-08 | **Spec**: `specs/028-normalize-execute-prompt/spec.md`  
**Input**: Feature specification from `specs/028-normalize-execute-prompt/spec.md`

## Summary

Normalize `execute-prompt sonar` and `execute-prompt fix-comments` so they use the same AI executor interface as `automata execute`: `--with <claude|codex>`, `--model <string>`, and verbose Claude output by default with `--silent` to suppress it. Preserve existing prompt construction and `--push` behavior.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode), Node.js LTS 18+  
**Primary Dependencies**: commander.js, node:child_process, vitest  
**Storage**: N/A  
**Testing**: vitest unit tests  
**Target Platform**: Node.js CLI  
**Project Type**: CLI tool  
**Performance Goals**: N/A  
**Constraints**: Minimal targeted edits; no new runtime dependencies; preserve existing Sonar and Fix-Comments prompt payloads  
**Scale/Scope**: Small CLI normalization touching one command module, unit tests, and docs

## Constitution Check

- ✅ CLI-First: changes remain commander.js subcommand options
- ✅ TypeScript strict: no `any`, explicit typed option object
- ✅ Single Responsibility: behavior stays localized to `executePrompt.ts`
- ✅ Simplicity: reuse existing Claude and Codex service functions instead of adding wrappers
- ✅ POSIX conventions: usage/help and option validation continue through commander with stderr on failure

## Project Structure

### Documentation (this feature)

```text
specs/028-normalize-execute-prompt/
├── spec.md
├── research.md
├── plan.md
├── tasks.md
├── pr-report.md
└── spec-decisions.md
```

### Source Code Changes

```text
src/
├── commands/
│   └── executePrompt.ts
└── index.ts

docs/
└── execute-prompt.md

tests/
└── unit/
    ├── executePrompt.cmd.test.ts
    └── executePromptFixComments.cmd.test.ts
```

**Structure Decision**: Keep all changes in the existing single-project CLI layout and localize behavioral changes to `src/commands/executePrompt.ts`, with matching updates in docs and unit tests.

## Implementation Design

### CLI option model

- Introduce a normalized option type: `{ with: string; model?: string; silent?: boolean; push?: boolean }`
- Add shared option registration helper for:
  - `--with <executor>` as a required option
  - `--model <string>`
  - `--silent`
  - `--push`
- Remove `--codex`, `--verbose`, `--opus`, `--sonnet`, and `--haiku`

### Executor dispatch

- Validate `options.with.toLowerCase()` to allow only `claude` or `codex`
- For Codex:
  - invoke `invokeCodexCode(prompt, { yolo: true, model: options.model })`
- For Claude:
  - invoke `invokeClaudeCode(prompt, { yolo: true, verbose: !options.silent, model: options.model })`

### Documentation and testing

- Update `docs/execute-prompt.md` examples and option tables to the normalized interface
- Rewrite existing unit assertions from `--codex` / model shorthand behavior to `--with` / `--model`
- Add coverage for required `--with`, invalid executor validation, and `--silent` default behavior
