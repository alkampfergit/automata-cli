# Research: Normalize Execute-Prompt Parameters

## Decision 1: Reuse the `execute` command's executor contract

**Decision**: Replace `execute-prompt`'s `--codex` toggle with the same required `--with <executor>` option used by `automata execute`.

**Rationale**: The issue explicitly asks to use the same options as `execute` for Claude and Codex selection. A shared contract is easier to learn and keeps executor validation behavior consistent across commands.

**Alternatives considered**:

- Keep default-Claude behavior and add `--with` as an alias. Rejected because it preserves two competing interfaces.
- Keep `--codex` for backwards compatibility. Rejected because the issue explicitly calls the current option set too complex.

## Decision 2: Replace model shorthands with free-form `--model`

**Decision**: Remove `--opus`, `--sonnet`, and `--haiku` from `execute-prompt` and use `--model <string>` for both Claude and Codex.

**Rationale**: The current shorthand flags are Claude-specific and do not generalize to Codex. `execute` already uses `--model`, so reusing it makes `execute-prompt` consistent and future-proof.

**Alternatives considered**:

- Keep shorthands and add `--model` alongside them. Rejected because it leaves duplicate ways to set models and keeps the interface noisy.
- Translate shorthands internally but hide them from docs. Rejected because hidden compatibility paths still complicate maintenance and tests.

## Decision 3: Align Claude verbosity with `execute`

**Decision**: Replace `--verbose` on `execute-prompt` with `--silent`, making verbose Claude output the default.

**Rationale**: The issue asks for the same option model as `execute`. Matching the default and suppression flag keeps the commands predictable and reduces cognitive load.

**Alternatives considered**:

- Leave `--verbose` unchanged while only normalizing executor/model options. Rejected because the commands would still disagree on the same Claude execution behavior.
- Support both `--verbose` and `--silent`. Rejected because it introduces conflicting flags for the same behavior.

## Decision 4: Preserve prompt-specific workflow flags

**Decision**: Keep `--push` unchanged on both `execute-prompt` subcommands.

**Rationale**: `--push` is not an executor/model selection shortcut; it is specific to the prompt workflow. Removing it would be an unrelated regression.

**Alternatives considered**:

- Drop `--push` to mirror `execute` exactly. Rejected because `execute` does not own the review/repair workflow semantics that `execute-prompt` already supports.

## Autonomous Decisions

- Required `--with` instead of defaulting to Claude because the issue asks to use the same options as `execute`, and `execute` requires explicit executor choice.
- Normalized verbosity to `--silent` because the user asked for the same option style as `execute`, not just the same model flag.
