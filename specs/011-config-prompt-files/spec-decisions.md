# Spec Decisions: Config Prompt Files

**Branch**: `011-config-prompt-files`
**Date**: 2026-04-01
**Spec**: [specs/011-config-prompt-files/spec.md](./spec.md)
**Plan**: [specs/011-config-prompt-files/plan.md](./plan.md)
**Research**: [specs/011-config-prompt-files/research.md](./research.md)

## Planning Decisions

- **Resolution location**: Resolve `.md` references inside `readConfig()` in `src/config/configStore.ts`. **Rationale**: Centralising resolution means all callers (getReady, executePrompt, tests) automatically receive resolved values without changes to their code. **Alternatives considered**: Resolving at each call site (rejected — fragile, touches more files); a separate `readConfigResolved()` function (rejected — callers still need updating).

- **Detection heuristic**: A config field value is a file reference if and only if it is a non-empty string ending with `.md`. **Rationale**: Simple, unambiguous, and consistent with the existing `claude-system-prompt.md` file already present in `.automata/`. **Alternatives considered**: Separate `*_file` field names (rejected — breaks existing config schema); JSON object `{"type":"file","name":"..."}` (rejected — over-engineered).

- **Path traversal prevention**: Use `path.resolve(automataDir, value)` and assert the resolved path starts with `path.resolve(automataDir) + path.sep`. **Rationale**: Reliable and idiomatic Node.js pattern. **Alternatives considered**: Regex blocklist (rejected — fragile); `path.basename(value)` only (rejected — silently drops path components instead of erroring).

- **Wizard filename mapping**: Deterministic filenames (`claude-system-prompt.md`, `sonar-prompt.md`, `fix-comments-prompt.md`). **Rationale**: Predictable location makes manual editing intuitive; avoids collisions; consistent with the existing file already in `.automata/`. **Alternatives considered**: UUID names (rejected — unpredictable); content hash names (rejected — unintuitive for editors).

- **CLI `config set` command**: No change — users who pass a `.md` filename get file-reference behaviour at read time transparently. **Rationale**: Keeps the CLI simple; the resolution is transparent and the convention is documented. **Alternatives considered**: Auto-create `.md` file when value doesn't end with `.md` (rejected — surprising side-effect, out of scope).
