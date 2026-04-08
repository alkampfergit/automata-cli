# Tasks: Normalize Execute-Prompt Parameters

**Input**: Design documents from `specs/028-normalize-execute-prompt/`
**Prerequisites**: `spec.md`, `research.md`, `plan.md`

## Phase 1: Core command normalization

- [X] T001 Update `src/commands/executePrompt.ts` to replace `--codex`, `--verbose`, `--opus`, `--sonnet`, and `--haiku` with `--with <executor>`, `--model <string>`, and `--silent`
- [X] T002 Validate `--with` in `src/commands/executePrompt.ts` and dispatch to Claude or Codex with the same executor/model semantics used by `src/commands/execute.ts`
- [X] T003 Preserve existing `--push` prompt augmentation and existing Sonar/Fix-Comments context generation

## Phase 2: Tests

- [X] T004 Update `tests/unit/executePrompt.cmd.test.ts` for `sonar` to cover `--with`, `--model`, default Claude verbosity, `--silent`, and invalid executor handling
- [X] T005 Update `tests/unit/executePromptFixComments.cmd.test.ts` for `fix-comments` to cover `--with`, `--model`, default Claude verbosity, `--silent`, and invalid executor handling

## Phase 3: Documentation

- [X] T006 Update `docs/execute-prompt.md` to document the normalized executor and model options

## Phase 4: Validation

- [X] T007 Run `npm test && npm run lint`
