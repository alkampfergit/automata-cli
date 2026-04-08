# Spec Decisions: Unify implement-next AI options

**Branch**: `022-unify-ai-options`
**Date**: 2026-04-08
**Spec**: [specs/022-unify-ai-options/spec.md](specs/022-unify-ai-options/spec.md)
**Plan**: [specs/022-unify-ai-options/plan.md](specs/022-unify-ai-options/plan.md)
**Research**: [specs/022-unify-ai-options/research.md](specs/022-unify-ai-options/research.md)

## Planning Decisions

- **Keep resolveModelOption in claudeService.ts**: Do not remove the function since `executePrompt.ts` still uses it. Only `getReady.ts` stops importing it. **Rationale**: Avoids breaking the sonar and fix-comments subcommands. **Alternatives considered**: Moving to a shared utility — rejected because only one consumer remains.

- **Default executor value**: Make `--with` optional with default `"claude"` via commander's default mechanism. **Rationale**: Matches current implicit default where Claude is used unless `--codex` is specified. Avoids breaking existing workflows. **Alternatives considered**: Making `--with` required — rejected as it adds friction.

- **Verbose as default behavior**: Replace `--verbose` (opt-in) with `--silent` (opt-out). **Rationale**: Matches the `execute` command's `--silent` pattern. Verbose is the more useful default for long-running AI tasks. **Alternatives considered**: Keeping `--verbose` — rejected because the goal is interface unification.

- **No changes to --no-claude naming**: Keep `--no-claude` as-is. **Rationale**: Commander's boolean negation pattern ties the flag name to the positive form. Renaming is out of scope. **Alternatives considered**: Renaming to `--no-ai` — rejected as it requires additional option rework.
