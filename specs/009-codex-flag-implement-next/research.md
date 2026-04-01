# Research: Codex Flag for Implement-Next and Test Codex Command

**Branch**: `009-codex-flag-implement-next` | **Date**: 2026-03-31

## Findings

### Codex CLI Interface

- Decision: Use `codex exec <prompt>` for non-interactive Codex invocation.
- Rationale: `codex exec` is the non-interactive subcommand analogous to Claude's `-p <prompt>` flag. For verbose mode, use `--json` which prints events to stdout as JSONL, equivalent to Claude's `--output-format stream-json --verbose`.
- Alternatives considered: Using `codex <prompt>` directly (interactive mode — rejected, blocks terminal). Using stdin piping — workable but adds complexity without benefit.

### Yolo Flag Mapping

- Decision: Map `--yolo` to `codex exec --dangerously-bypass-approvals-and-sandbox`.
- Rationale: This is explicitly stated in the feature description. The codex exec help confirms this flag exists and has the same semantics as Claude's `--dangerously-skip-permissions`.
- Alternatives considered: None — explicitly specified in the feature requirements.

### Verbose Mode for Codex

- Decision: Implement verbose mode by reading JSONL events from `codex exec --json` stdout and formatting them similarly to Claude's verbose mode, using the same `spawn` + readline pattern already established in `claudeService.ts`.
- Rationale: Codex exec supports `--json` for JSONL output. The existing `invokeClaudeCodeVerbose` in `claudeService.ts` provides the exact same pattern (spawn + readline + format events). This minimizes new code and maximizes consistency.
- Alternatives considered: Piping stdout directly to process.stdout — rejected because it defeats the purpose of verbose mode (formatted progress). Using `--output-last-message` — useful for getting final output but not for streaming progress.

### Service Module Location

- Decision: Create `src/codex/codexService.ts` mirroring `src/claude/claudeService.ts`.
- Rationale: Following the existing pattern keeps the codebase organized and follows the Single Responsibility principle from the constitution. The `src/claude/` directory precedent establishes a per-AI-provider directory pattern.
- Alternatives considered: Adding Codex functions to `claudeService.ts` — rejected, violates Single Responsibility and mixes concerns. Creating a generic `aiService.ts` abstraction — YAGNI; over-engineering for two providers.

### `--codex` Flag Interaction with `--no-claude`

- Decision: `--no-claude` skips all AI invocation (including Codex). `--codex` is only checked when `options.claude !== false`.
- Rationale: `--no-claude` semantically means "skip the AI step entirely" and the existing code checks `if (options.claude !== false)`. Keeping Codex inside this guard is simplest and consistent.
- Alternatives considered: Allowing `--codex` to bypass `--no-claude` — rejected, confusing semantics and no use case identified.

### Codex Verbose Event Format

- Decision: Parse JSONL events from `codex exec --json`, format `agent_message` events (showing text content preview) and a final result summary, matching the style of Claude's verbose formatter.
- Rationale: Consistency with Claude's output format reduces user confusion. Codex JSONL events include typed messages that can be parsed similarly.
- Alternatives considered: Raw passthrough of Codex output — rejected for verbose mode (non-verbose mode already does raw passthrough via inherit stdio).

## Autonomous Decisions

- [AUTO] Codex binary name: `codex` — confirmed on PATH at `/usr/local/share/nvm/versions/node/v24.14.1/bin/codex`.
- [AUTO] Non-interactive invocation: `codex exec <prompt>` — confirmed from `codex exec --help`.
- [AUTO] Verbose JSONL flag: `--json` on `codex exec` — confirmed from `codex exec --help`.
- [AUTO] Model flags omitted: Codex model selection uses `-c model="..."` config syntax which differs from Claude's `--model` flag; excluded from this feature per minimal scope requirement.
