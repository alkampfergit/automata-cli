# Spec Decisions: Codex Flag for Implement-Next and Test Codex Command

**Branch**: `009-codex-flag-implement-next`
**Date**: 2026-04-01
**Spec**: [specs/009-codex-flag-implement-next/spec.md](./spec.md)
**Plan**: [specs/009-codex-flag-implement-next/plan.md](./plan.md)
**Research**: [specs/009-codex-flag-implement-next/research.md](./research.md)

## Planning Decisions

- **Codex invocation style**: Use `codex exec <prompt>` for non-interactive invocation. **Rationale**: `codex exec` is the non-interactive subcommand analogous to Claude's `-p <prompt>` flag, confirmed via `codex exec --help`. **Alternatives considered**: `codex <prompt>` directly (interactive mode — blocks terminal); stdin piping (adds complexity without benefit).

- **Verbose mode implementation**: Use `codex exec --json` which emits JSONL events to stdout, parsed with the same `spawn` + readline pattern from `claudeService.ts`. **Rationale**: Consistency with existing Claude verbose mode minimises new code and maintains a uniform UX. **Alternatives considered**: Raw stdout passthrough (defeats purpose of verbose); `--output-last-message` (no streaming progress).

- **Service module location**: New `src/codex/codexService.ts` mirroring `src/claude/claudeService.ts`. **Rationale**: Single Responsibility principle; establishes a per-AI-provider directory pattern consistent with the existing codebase. **Alternatives considered**: Adding Codex functions to `claudeService.ts` (mixes concerns); generic `aiService.ts` abstraction (YAGNI).

- **`--no-claude` interaction**: `--no-claude` skips all AI invocation including Codex — `--codex` is only evaluated inside the `if (options.claude !== false)` guard. **Rationale**: `--no-claude` semantically means "skip the AI step entirely"; keeping Codex inside the guard is simplest and consistent. **Alternatives considered**: Allowing `--codex` to bypass `--no-claude` (confusing semantics, no identified use case).

- **Model flags omitted**: No `--model` or Opus/Sonnet/Haiku flags for Codex. **Rationale**: Codex model selection uses `codex -c model="..."` config syntax which differs from Claude's `--model` flag; excluded per minimal scope requirement. **Alternatives considered**: Exposing a generic `--model` flag (out of scope for this iteration).
