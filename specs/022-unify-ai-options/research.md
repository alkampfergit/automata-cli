# Research: Unify implement-next AI options

## Autonomous Decisions

### Decision 1: Keep resolveModelOption in claudeService.ts
- **Decision**: Do not remove `resolveModelOption` or `MODEL_IDS` from `claudeService.ts`
- **Rationale**: `executePrompt.ts` (sonar and fix-comments subcommands) still uses both. Only `getReady.ts` will stop importing them.
- **Alternatives considered**: Moving them to a shared utility — rejected because only one consumer remains and the function is small.

### Decision 2: Default executor value
- **Decision**: Make `--with` optional with default value `"claude"` using commander's default mechanism
- **Rationale**: Matches the current implicit default (Claude is used when `--codex` is not specified). Using commander's `.option("--with <executor>", "...", "claude")` pattern keeps it explicit.
- **Alternatives considered**: Making `--with` required — rejected because it would break existing workflows and add friction.

### Decision 3: Verbose as default behavior
- **Decision**: Replace `--verbose` (opt-in) with `--silent` (opt-out), making verbose the default
- **Rationale**: The execute command uses `--silent` to suppress output. Matching this pattern means implement-next shows progress by default (which is the more useful default for long-running AI tasks).
- **Alternatives considered**: Keeping `--verbose` as-is — rejected because the goal is interface unification.

### Decision 4: No changes to --no-claude naming
- **Decision**: Keep `--no-claude` as-is
- **Rationale**: Commander's boolean negation requires the flag name to match the positive form. Changing to `--no-ai` would require adding `.option("--ai", ...)` which changes the semantics. Out of scope for this refactor.
- **Alternatives considered**: Renaming to `--no-ai` — rejected as out of scope and would require additional option rework.

## Dependencies

- No new dependencies required
- No external API changes
