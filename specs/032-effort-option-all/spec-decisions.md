# Spec Decisions: `--effort` on every AI-invoking command

**Branch**: `feature/032-ai-effort`
**Date**: 2026-09-10
**Spec**: [specs/032-effort-option-all/spec.md](spec.md)
**Plan**: [specs/032-effort-option-all/plan.md](plan.md)
**Research**: [specs/032-effort-option-all/research.md](research.md)

## Planning Decisions

- **Per-executor flag syntax**: `claude` gets `--effort <level>`; `codex` gets `-c model_reasoning_effort="<level>"`.
  **Rationale**: verified against the binaries installed in this container — `claude --help` lists `--effort <level>`,
  `codex exec --help` lists no effort flag, and `model_reasoning_effort` is present in the codex binary as a config
  key, with `-c key=value` documented as the per-invocation override. The value is quoted because `-c` parses it as
  TOML. **Alternatives considered**: a composite `--model <model>-<effort>` id (undocumented, collides with `--model`);
  writing `~/.codex/config.toml` from automata (a process-global side effect that would leak between runs).

- **Where the flag becomes argv**: inside the existing `buildClaudeArgs` / `buildCodexArgs`, via a new `effort?: string`
  on each executor's options interface. **Rationale**: those builders are already the single source of the argv, and
  `buildClaudeArgs`'s own comment records why — `do-work --dry-run` prints their output, so building arguments anywhere
  else would let the dry run drift from what actually runs. **Alternatives considered**: appending the flag at each of
  the five call sites — rejected as duplication across two syntaxes that would also break `--dry-run` fidelity.

- **Validation**: reject only empty/whitespace-only values; forward anything else unchanged. **Rationale**: the valid
  set is executor- *and* model-specific and moves between executor releases, so an allow-list in automata would reject
  a level the installed executor accepts and would need an automata release to unblock. Proposed on issue #48 with
  this rationale and not objected to. **Verified cost**: neither executor *errors* on an unknown level — `claude`
  warns and falls back to its default, `codex` forwards it and shows it in its session header — so this removes the
  check rather than relocating it. Documented in `docs/config.md` and `docs/do-work.md` as such. **Alternatives
  considered**: a per-executor allow-list (release-coupled, and revisitable if typos bite in practice); no check at
  all (`--effort ""` would emit an empty argument codex would try to parse as TOML).

- **Config shape and scope**: `doWork.effort: { claude?, codex? }`, resolved `--effort` > `doWork.effort[executor]` >
  nothing, and scoped to `do-work` only. **Rationale**: an exact mirror of `doWork.models`, including its recorded
  reason — a value meaningful to one executor is not for the other, so a shared field would silently pass nonsense when
  `doWork.executor` changes. Mirroring also means `validateSettingContainer` and `writeDoWork` cover validation and
  persistence with no new code. `execute` / `execute-prompt` / `implement-next` have no configured `--model` default
  either. **Alternatives considered**: a single shared `doWork.effort` string (executor mismatch); a new top-level
  `ai: { models, effort }` block shared by all commands — a config migration for the existing `doWork.models`, and
  explicitly deferred on the issue.

- **Project structure**: no new module; the change is additive fields on existing interfaces and one line in each
  builder. **Rationale**: the only computation is a two-branch string-to-argv mapping that belongs beside the flag it
  is a sibling of; a module for it would be the indirection the constitution's Simplicity principle forbids.

- **Wizard screen placement**: each effort screen sits immediately after its executor's model screen. **Rationale**:
  the two settings are read and set together, and only the single test that walks the Do Work chain key-by-key is
  affected — the others navigate with the `advanceTo(...)` helper. **Alternatives considered**: appending both screens
  at the end of the chain, which would move save-and-exit off `do-work-lock-stale` and break more tests for a worse
  ordering.
