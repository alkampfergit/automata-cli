# PR Report: Choose the executor and model from the triggering message

**Branch**: `feature/032-message-tool-model`
**Date**: 2026-09-10
**Spec**: [specs/032-message-tool-model/spec.md](spec.md)

## Summary

`do-work` now reads `tool:claude` / `tool:codex` and `model:<id>` out of the newest authorized
message that triggers a turn, and runs that turn with them. A maintainer can steer one turn
to a different executor or model from the text of their comment — no config change, no CLI
flag, no access to the harness machine — and the choice applies to that turn only, because
every tick re-reads whatever message is newest then.

## What's New

- **`src/github/runDirective.ts` (new, pure)**: the three rules the feature turns on —
  `triggeringMessage(item)` (which message counts), `parseRunDirective(body)` (two
  lookbehind-guarded case-insensitive regexes, last occurrence wins) and
  `resolveExecution(input)` (the four-source precedence chain). No I/O, no commander, no
  `gh`, matching how `conversation.ts` and `workDetection.ts` hold the rest of the loop's
  safety-critical rules.
- **Per-item executor and model resolution in `do-work`**: `Settings` now holds the *inputs*
  (`withOption`, `modelOption`, `configExecutor`, `configModels`) and each work item resolves
  its own `ResolvedExecution`. A tick answers several issues with their own newest messages,
  so a tick-wide value could not express the feature — and passing the result as a parameter
  rather than mutating `Settings` means no item can leak its choice into the next.
- **Precedence**: message directive → `--with` / `--model` → `doWork.executor` /
  `doWork.models.<executor>` → `claude`. When a `tool:` directive *switches* executor without
  naming a model, `--model` is dropped and the new executor's configured default is used
  instead — a Claude identifier is not a valid Codex model, which is why `doWork.models` is
  keyed per executor in the first place.
- **Refusal on an unrecognised `tool:` value**: no executor is invoked, the `working…` marker
  is updated to quote the value back and name `claude` / `codex`, and the item is reported
  `failed` (exit 2). It sits beside the existing oversized-prompt refusal, *after* the marker
  is posted — that is what advances the answer boundary, so the typo is explained once
  instead of being re-refused on every later tick. It does not consume a slot from the run
  cap, and other items in the tick are unaffected.
- **Reporting**: the tick summary names the effective executor and model on every item line,
  adding `— from the message` when a directive supplied either; the `--dry-run` `Executor`
  header does the same and shows the refusal instead of a command for a refused item.
- **`--json`**: `executor`, `model`, `executorSource` and `modelSource` on each completed
  item, and on each entry of `runs` in a dry run, plus a `refusal` field there.
- **Docs**: a "Steering one turn from a message" section in `docs/do-work.md` with the
  precedence, the never-persists rule, the refusal text and the dry-run forms; the marker
  table and the `failed` exit-code row extended; cross-references from the `executor` and
  `models.claude` rows in `docs/config.md`.

## Breaking Changes

- **`do-work --json` item shape**: `items[]` entries are now emitted through an explicit
  mapper and always carry `ranExecutor` (previously omitted when false) plus the four new
  `executor` / `model` / `executorSource` / `modelSource` fields. Additive for any consumer
  reading known keys; a consumer doing an exact-shape comparison needs updating. The one such
  assertion in the repo's own suite was updated in this PR.

## Testing

- **Unit (`tests/unit/runDirective.test.ts`, 52 cases)**: every row of the `parseRunDirective`
  table including case handling, last-occurrence-wins, the `mytool:` / `no-tool:` / `x:tool:`
  non-matches and vendor-prefixed model identifiers; both precedence tables including the
  `--model` drop on a switch and its *absence* on a no-op directive; `triggeringMessage` for a
  discuss turn, an already-answered surface, an issue description on a first turn, a build
  turn triggered by an issue message, a thread-only trigger and a stale thread; the two
  rendering helpers.
- **Command-level (`tests/unit/doWork.cmd.test.ts`, 20 new cases)**: `tool:codex` routes to
  the Codex runner and beats `--with`; `model:` reaches the argv and beats `--model`; a
  switch uses the new executor's configured model and drops `--model`; a directive in an
  older message is ignored; the directive survives into the prompt; the summary, `--dry-run`
  header and both `--json` shapes report the origin; and for the refusal — nothing invoked,
  the marker text, `failed` + exit 2, a second issue in the tick still runs, the run cap is
  not consumed, and `--dry-run` shows the refusal with no command.
- **Regression**: the whole pre-existing suite passes unmodified apart from the one
  exact-shape `--json` assertion noted above. `npm test && npm run lint` green — 744 tests
  across 28 files, `eslint src/` clean.
- **Mutation check**: the run-cap guard was verified by making the refusal path set
  `ranExecutor: true` and confirming the suite went red, then restoring.

## Notes

- `automata implement-next` is deliberately untouched — it is not message-driven, and the
  issue thread confirmed it is out of scope.
- A `model:` value is never validated. automata cannot hold either executor's model catalogue,
  so an unknown identifier is passed through and the executor's rejection surfaces as an
  ordinary run failure through the existing marker reconciliation.
- The directive is not stripped from the prompt, so the model sees the same text the
  maintainer wrote. Fenced-code-block awareness was rejected as premature for the same
  reason — it would need a markdown parser and would change nothing the model sees.
- `src/commands/doWork.ts` and `tests/unit/doWork.cmd.test.ts` already failed
  `prettier --check` on `develop`; they were left as-is rather than reformatted, so the diff
  stays reviewable. The two new files are Prettier-clean.
