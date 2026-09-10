# Feature Specification: `--effort` on every AI-invoking command

**Feature Branch**: `feature/032-ai-effort`
**Created**: 2026-09-10
**Status**: Draft
**Issue**: [#48](https://github.com/alkampfergit/automata-cli/issues/48)
**Input**: "Add config to specify default effort and a cmdline parameter to specify effort for do work" plus the
follow-up "Add effort to other command too in cmdline".

## Overview

Both executors automata can drive expose a reasoning-effort control, and today automata offers no way to reach it.
`claude` takes a first-class `--effort <level>` flag; `codex` has no dedicated flag and instead reads
`model_reasoning_effort` from its config, overridable per invocation with `-c model_reasoning_effort="<level>"`.

This feature adds a `--effort <level>` option to every automata command that invokes an executor, and a configured
default for `do-work` under `doWork.effort`, keyed per executor exactly as `doWork.models` already is.

## User Scenarios & Testing

### User Story 1 — Raise effort for one run (Priority: P1)

An operator running a single command wants the executor to think harder on this particular task without changing any
saved configuration.

**Why this priority**: It is the whole of the original request's "cmdline parameter" half and delivers value with no
config change at all.

**Acceptance Scenarios**:

1. **Given** the `claude` executor, **When** the operator runs `automata execute --with claude --effort high --prompt
   "…"`, **Then** automata spawns `claude` with `--effort high` among its arguments.
2. **Given** the `codex` executor, **When** the operator runs `automata execute --with codex --effort high --prompt
   "…"`, **Then** automata spawns `codex` with `-c model_reasoning_effort="high"` among its arguments.
3. **Given** no `--effort` is passed, **When** any command invokes an executor, **Then** no effort argument is emitted
   at all and the executor applies its own default.

### User Story 2 — A standing default for the unattended loop (Priority: P1)

`do-work` runs unattended on a schedule, so there is no command line to type a flag onto. The operator wants to set the
effort once, per executor, and have every tick use it.

**Why this priority**: It is the "config" half of the original request and the only way the option reaches the
autonomous loop.

**Acceptance Scenarios**:

1. **Given** `doWork.effort.claude` is `"high"` and `doWork.executor` is `claude`, **When** a tick invokes the executor,
   **Then** `claude` is spawned with `--effort high`.
2. **Given** `doWork.effort.claude` is `"high"` and `doWork.executor` is `codex`, **When** a tick runs, **Then** no
   effort argument is emitted — the claude entry does not leak to codex.
3. **Given** `doWork.effort.claude` is `"medium"`, **When** the operator runs `automata do-work --effort high`, **Then**
   the command line wins and `--effort high` is emitted.
4. **Given** any configured or passed effort, **When** the operator runs `automata do-work --dry-run`, **Then** the
   printed command is the exact argv that would be spawned, including the effort argument.

### User Story 3 — Set and inspect the default (Priority: P2)

The operator wants to set the default through the documented paths rather than hand-editing JSON.

**Acceptance Scenarios**:

1. **When** the operator runs `automata config set do-work-effort claude high`, **Then** `doWork.effort.claude` is
   persisted as `"high"` and the rest of the config is untouched.
2. **When** the operator runs `automata config set do-work-effort bogus high`, **Then** the command exits non-zero
   naming the valid executors.
3. **When** the operator walks the `Do Work` wizard section, **Then** an effort screen for each executor appears and its
   value is persisted with the rest of the section.

### Edge Cases

- `doWork.effort` present but not an object, or carrying an unknown key → `do-work` fails validation with a message
  naming the offending path, exactly as `doWork.models` already does.
- `--effort ""` or an all-whitespace value → rejected at the command line rather than emitting an empty argument.
- An effort level the executor does not accept → forwarded unchanged; the executor reports it. See Assumptions.
- `implement-next --no-claude` → no executor runs, so `--effort` has no effect and is not an error.

## Requirements

### Functional Requirements

- **FR-001**: `automata do-work`, `automata execute`, `automata execute-prompt sonar`, `automata execute-prompt
  fix-comments`, `automata execute-prompt check-issue` and `automata implement-next` MUST each accept
  `--effort <level>`.
- **FR-002**: When an effort level is in force and the executor is `claude`, the spawned argv MUST contain
  `--effort <level>`.
- **FR-003**: When an effort level is in force and the executor is `codex`, the spawned argv MUST contain
  `-c` followed by `model_reasoning_effort="<level>"`.
- **FR-004**: When no effort level is in force, the spawned argv MUST contain no effort argument for either executor.
- **FR-005**: The config MUST support `doWork.effort`, an object with optional `claude` and `codex` string members.
- **FR-006**: `do-work` MUST resolve effort as `--effort` > `doWork.effort[<executor in use>]` > none.
- **FR-007**: `do-work` MUST reject a malformed `doWork.effort` (non-object, non-string member, unknown key) with a
  non-zero exit and a message naming the path.
- **FR-008**: `automata config set do-work-effort <executor> <value>` MUST persist the value, validating the executor
  against `claude|codex` and rejecting an empty value.
- **FR-009**: The `config` wizard's Do Work section MUST offer an effort field per executor and persist both with the
  section's other fields.
- **FR-010**: `do-work --dry-run` MUST print the effort argument as part of the command it would launch, and the
  `--json` plan MUST report the resolved effort.
- **FR-011**: An empty or whitespace-only `--effort` value MUST be rejected with a non-zero exit.
- **FR-012**: A non-empty effort value MUST be forwarded to the executor unchanged, without automata validating it
  against a list of levels.

### Key Entities

- **Effort level**: an opaque non-empty string naming how hard the executor should think. Its valid values are
  executor- and model-specific (`claude`: `low|medium|high|xhigh|max`; `codex`: `minimal|low|medium|high`, plus `xhigh`
  on max-class models) and change between executor releases, so automata carries no list of them.
- **`doWork.effort`**: an optional config object, `{ claude?: string, codex?: string }`, mirroring `doWork.models`.

## Success Criteria

- **SC-001**: Every one of the six command surfaces accepts `--effort` and reaches the executor with it.
- **SC-002**: A `doWork.effort` entry applies to a `do-work` tick only when its key matches the executor in use.
- **SC-003**: A run with no effort configured and no flag produces byte-identical argv to the current release.
- **SC-004**: `do-work --dry-run` output and the real spawn agree, because both come from the same argument builder.

## Assumptions

- [AUTO] **Codex wiring**: chose `-c model_reasoning_effort="<level>"` because `codex exec --help` exposes no effort
  flag, while `-c <key=value>` is documented as the per-invocation override and `model_reasoning_effort` is present in
  the installed codex binary as a config key.
- [AUTO] **Validation**: chose pass-through of any non-empty string over a per-executor allow-list, because the valid
  set is model-dependent and moves between executor releases; an allow-list would reject a newly-shipped level until
  automata cut a release. Raised on the issue and not objected to.
- [AUTO] **Config scope**: chose to add the configured default under `doWork` only, mirroring `models`, because
  `execute`, `execute-prompt` and `implement-next` have no configured `--model` default either. A default shared by all
  commands would mean promoting `models` + `effort` to a new top-level block — a config migration, out of scope here.
- [AUTO] **Shape**: chose an object keyed by executor over a single shared string, for the reason already recorded on
  `DoWorkModels`: a level meaningful to one executor may be invalid on the other, so a shared field would silently pass
  nonsense when the executor changes.
- [AUTO] **`implement-next --no-claude`**: chose to accept `--effort` silently rather than warn, because the command
  already accepts `--model` under `--no-claude` without a warning.
- [AUTO] **Wizard placement**: chose to put each effort screen immediately after its executor's model screen, since the
  two settings are read together, rather than appending both at the end of the Do Work chain.

## Clarifications

- Q: Should `--effort` be added to commands beyond `do-work`? → A: Yes, all six AI-invoking surfaces. [Resolved by the
  issue author on #48: "Add effort to other command too in cmdline".]
- Q: Should automata validate the level against an allow-list? → A: No, pass through any non-empty string. [AUTO:
  proposed on the issue with the rationale, not objected to; the valid set is model-dependent and release-coupled.]
- Q: Should the configured default cover every command or only `do-work`? → A: Only `do-work`. [AUTO: matches how
  `models` behaves today; a global default is a config migration and was explicitly deferred on the issue.]
