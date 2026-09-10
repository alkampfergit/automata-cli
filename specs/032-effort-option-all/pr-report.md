# PR Report: `--effort` on every AI-invoking command

**Branch**: `feature/032-ai-effort`
**Date**: 2026-09-10
**Spec**: [specs/032-effort-option-all/spec.md](spec.md)

## Summary

Both executors automata can drive expose a reasoning-effort control, and until now automata offered no way to reach it.
This adds `--effort <level>` to every command that invokes an executor, and a configured default for the unattended
`do-work` loop under `doWork.effort`, keyed per executor exactly as `doWork.models` already is.

## What's New

- **Executor argv builders** (`buildClaudeArgs`, `buildCodexArgs`): a new `effort?: string` option becomes
  `--effort <level>` for Claude and `-c model_reasoning_effort="<level>"` for Codex, which has no effort flag of its
  own and reads the level from its TOML config. Both syntaxes were verified against the binaries, not assumed. Putting
  the mapping in the builders is what keeps `do-work --dry-run` honest — it prints their output, so the printed command
  cannot drift from the real spawn.
- **`--effort <level>` on all six AI-invoking surfaces**: `do-work`, `execute`, `implement-next`, and — through one
  edit to the shared `addAiOptions` — `execute-prompt sonar`, `fix-comments` and `check-issue`.
- **`doWork.effort` config**: `{ claude?, codex? }`, mirroring `doWork.models`. Keyed per executor for the reason
  already recorded on `DoWorkModels`: the two CLIs take different level names, so a shared field would silently pass
  nonsense the moment the executor changed. Resolution is `--effort` > `doWork.effort[<executor in use>]` > no argument
  at all. Reuses the existing `validateSettingContainer` so a malformed section fails the tick with the offending path
  named.
- **`automata config set do-work-effort <executor> <level>`**: mirrors `do-work-model`, merging into the section
  without disturbing the models.
- **Config wizard**: a `Do Work — Claude Effort` and `Do Work — Codex Effort` screen, each immediately after its
  executor's model screen, persisted with the rest of the section.
- **`do-work` diagnostics**: the dry-run header gains `· effort <level>`, and `--dry-run --json` reports
  `effort` beside `model` so a scheduler sees the resolved value.
- **Shared `resolveEffortOption`** in `src/cli/spawnUtils.ts`: rejects an empty or whitespace-only value rather than
  emitting a flag with no operand. One helper rather than four copies.

## Breaking Changes

None. With no `--effort` and no `doWork.effort` configured, the emitted argv is byte-identical to the current release —
asserted directly by unit tests on both builders.

## Testing

- **Unit — argv (`claudeService`, `codexService`)**: exact argv with effort alone and alongside `--model`, the quoted
  TOML form for codex, and no argument at all when effort is absent or empty.
- **Unit — `do-work`**: flag reaches the executor; the configured default applies; the flag beats the config; a
  `claude` entry does not leak into a `codex` run; a malformed `doWork.effort` (non-object, empty member, unknown key)
  fails validation; `--dry-run` prints the effort argument for both executors; `--dry-run --json` reports it; an empty
  `--effort` exits 1 without invoking anything.
- **Unit — other surfaces**: `execute` (real argv via a fake executor on `PATH`, both executors, absent case, empty
  case), `execute-prompt` (both executors plus the absent case), `implement-next` (both executors, exact argv).
- **Unit — config**: `config set do-work-effort` persistence, per-executor separation, coexistence with `models`,
  unknown executor and empty value rejected.
- **Unit — wizard**: both screens reachable after their model screens, back-navigation, and both levels present in the
  saved config after a full walk of the Do Work chain.
- **Mutation-checked**: each of the five load-bearing edits was reverted in turn (claude emission, codex emission, the
  `doWork.effort` fallback, leaking the claude default to codex, wizard persistence) and the suite went red each time.
- **End-to-end**: the built CLI run against fake executors on `PATH` produced
  `["exec","--dangerously-bypass-approvals-and-sandbox","-c","model_reasoning_effort=\"high\"","hello"]` and
  `["--dangerously-skip-permissions","--model","claude-opus-5","--effort","xhigh","-p","hello"]`. Against the **real**
  codex binary, `-c model_reasoning_effort="high"` is accepted and reported as `reasoning effort: high` in its session
  header.
- `npm test` (711 passed) and `npm run lint` both green; `tsc --noEmit` clean.

## Notes

- **A mistyped level is quiet, not fatal.** automata forwards any non-empty level rather than allow-listing, because
  the valid set is executor- *and* model-specific and moves between executor releases. Verified against both binaries,
  neither *errors* on an unknown level: `claude` prints `Warning: Unknown --effort value 'bogus' — ignoring it and
  using the default effort. Valid values: low, medium, high, xhigh, max.` and runs at its default, while `codex`
  accepts it and shows `reasoning effort: bogus` in its session header. So this removes the check rather than
  relocating it. Documented as such in `docs/config.md` and `docs/do-work.md`; say the word if you would rather have a
  per-executor allow-list and accept the release coupling.
- **The configured default covers `do-work` only**, matching how `doWork.models` already behaves —
  `execute`, `execute-prompt` and `implement-next` take the flag but have no configured default, exactly as they have
  none for `--model`. A default shared by every command would mean promoting `models` + `effort` to a top-level `ai`
  block, which is a config migration; deferred on the issue and out of scope here.
- **`README.md` is unchanged**: no new command group, and no change to installation, the quick start or the dev setup.
  Per the documentation convention in `AGENTS.md`, the subcommand detail lives in `docs/`.
