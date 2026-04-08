# Spec Decisions: Normalize Execute-Prompt Parameters

**Branch**: `feature/028-normalize-execute-prompt`
**Date**: 2026-04-08
**Spec**: specs/028-normalize-execute-prompt/spec.md
**Plan**: specs/028-normalize-execute-prompt/plan.md
**Research**: specs/028-normalize-execute-prompt/research.md

## Planning Decisions

- **Executor selection contract**: Replace `--codex` with required `--with <executor>`. **Rationale**: the issue explicitly asks to use the same executor-selection pattern as `execute`. **Alternatives considered**: keeping `--codex` as a shortcut or alias.
- **Model selection contract**: Replace `--opus`, `--sonnet`, and `--haiku` with free-form `--model <string>`. **Rationale**: a single model option works for both Claude and Codex and matches `execute`. **Alternatives considered**: keeping Claude-only shortcuts alongside `--model`.
- **Verbosity contract**: Replace `--verbose` with `--silent` so Claude is verbose by default. **Rationale**: matching `execute` removes another avoidable CLI inconsistency. **Alternatives considered**: normalizing only executor/model selection while leaving `--verbose` unchanged.
- **Structure decision**: Keep changes localized to `src/commands/executePrompt.ts`, tests, and docs. **Rationale**: the issue is a targeted CLI normalization, not a service redesign. **Alternatives considered**: introducing a shared abstraction layer for AI option parsing.
