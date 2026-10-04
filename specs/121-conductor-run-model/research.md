# Research

## Autonomous Decisions

- **Decision**: Put the read-only rule in `buildClaudeArgs`/`buildCodexArgs`. **Rationale**: one place builds the argv, as the repository memory requires. **Alternatives considered**: flags at the call site.
- **Decision**: Claude `--permission-mode dontAsk` with an allow-list. **Rationale**: an unlisted tool is refused, and nobody can answer a prompt. **Alternatives considered**: `plan` mode, which cannot run `gh`.
- **Decision**: The posting instruction is appended by automata after the thread. **Rationale**: a custom frame cannot lose it. **Alternatives considered**: only in the default prompts.
- **Decision**: Detect by comparing the account's comments before and after. **Rationale**: it needs no transcript and works for both executors. **Alternatives considered**: recovery from the transcript (#115).
