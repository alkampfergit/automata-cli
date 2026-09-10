# Research: `--effort` on every AI-invoking command

**Branch**: `feature/032-ai-effort` | **Date**: 2026-09-10 | **Spec**: `specs/032-effort-option-all/spec.md`

## How each executor expresses reasoning effort

**Decision**: `claude` → `--effort <level>`; `codex` → `-c model_reasoning_effort="<level>"`.

**Rationale**: verified against the binaries installed in this container rather than from memory.

```
$ claude --help | grep effort
  --effort <level>                      Effort level for the current session

$ codex exec --help | grep -i effort
(no output — codex exposes no effort flag)

$ codex --help
  -c, --config <key=value>
          Override a configuration value that would otherwise be loaded from `~/.codex/config.toml`.
          … Examples: - `-c model="o3"` …

$ grep -ao model_reasoning_effort node_modules/@openai/codex-linux-x64/.../bin/codex | head -1
model_reasoning_effort
```

So codex reads the level from its TOML config under `model_reasoning_effort`, and `-c key=value` is the documented
per-invocation override. The value is quoted (`model_reasoning_effort="high"`) because `-c` parses the value portion as
TOML and an unquoted bare word is not a valid TOML string.

**Alternatives considered**:

- `codex --model <model>-<effort>` composite ids — rejected: not a documented form, and it would collide with `--model`.
- Writing `~/.codex/config.toml` from automata — rejected: process-global side effect on the operator's machine, and it
  would leak between concurrent runs.

## Where the flag is turned into argv

**Decision**: extend `InvokeClaudeOptions` / `InvokeCodexOptions` with `effort?: string` and emit it inside
`buildClaudeArgs` / `buildCodexArgs`.

**Rationale**: both builders are already the single source of the argv, and `buildClaudeArgs`'s own comment records
why — `do-work --dry-run` prints their output, so building the arguments anywhere else would let the dry run drift from
what actually runs. Putting `effort` there makes the dry run correct with no extra work. Every caller
(`invokeClaudeCode`, `invokeCodexCode`, `runClaude`, `runCodex`, `do-work`'s `planRun`) then needs one option threaded
through.

**Alternatives considered**:

- Appending the flag at each call site — rejected: five call sites, two syntaxes, and `--dry-run` would print argv the
  real spawn did not use.

## Validation strategy

**Decision**: reject only empty/whitespace-only values; forward anything else unchanged.

**Rationale**: the valid set is both executor-specific and model-specific (`claude`: `low|medium|high|xhigh|max`;
`codex`: `minimal|low|medium|high`, `xhigh` on max-class models) and moves between executor releases. A hard allow-list
in automata would reject a level the installed executor accepts, and would need an automata release to unblock.
Proposed on issue #48 with this rationale and not objected to.

**Verified cost of this choice.** Neither executor errors on an unknown level, so the pass-through does not simply
relocate the check — it removes it:

```
$ claude --effort bogus -p "say hi"
Warning: Unknown --effort value 'bogus' — ignoring it and using the default effort. Valid values: low, medium, high, xhigh, max.
Hi! …                                                       # exit 0, ran at the default effort

$ codex exec -c model_reasoning_effort="bogus" "hi"
…
reasoning effort: bogus                                     # accepted, forwarded to the API
```

Claude's warning at least names the valid set, so a typo is visible in the output; codex's is only visible in its
session header. Documented as such rather than claimed as executor-side validation, and revisitable if operators hit
it in practice.

**Alternatives considered**:

- Per-executor allow-list — rejected for the release-coupling above. Recorded in the spec's Assumptions so it can be
  revisited if operators hit typos in practice.
- No check at all — rejected: `--effort ""` would emit an empty argument, which codex would try to parse as TOML.

## Config shape

**Decision**: `doWork.effort: { claude?: string, codex?: string }`, resolved as `--effort` >
`doWork.effort[executor]` > nothing.

**Rationale**: an exact mirror of `doWork.models`, including the reason recorded on the `DoWorkModels` interface —
a value meaningful for one executor is not for the other, so a shared field would silently pass nonsense when
`doWork.executor` changes. Mirroring also means `validateSettingContainer(section["effort"], "effort", ["claude",
"codex"])` covers validation with no new code, and `writeDoWork` covers persistence.

**Alternatives considered**:

- A single `doWork.effort` string — rejected for the executor-mismatch reason above.
- A top-level `ai: { models, effort }` block shared by every command — rejected as out of scope: it is a config
  migration for the existing `doWork.models`, and it was explicitly deferred on the issue.

## Command surfaces

**Decision**: six surfaces. `execute-prompt`'s three subcommands get it from one edit to `addAiOptions`; `do-work`,
`execute` and `implement-next` declare their own options and each need an explicit line.

**Rationale**: this is the existing split — `addAiOptions` supplies `--with/--model/--silent/--push` to the
`execute-prompt` subcommands only, while the three top-level commands declare `--model` themselves. Following it keeps
the diff to one line per surface.

## Autonomous Decisions

- **Wizard screen placement**: each effort screen goes immediately after its executor's model screen
  (`do-work-claude-model` → `do-work-claude-effort` → `do-work-codex-model` → `do-work-codex-effort` → …), because the
  two are read and set together. The cost is that the one wizard test that walks the whole Do Work chain key-by-key
  needs two more entries; the other tests use the `advanceTo(...)` helper, which searches for a screen by title and is
  unaffected. Appending both screens at the end of the chain would instead move the save-and-exit off
  `do-work-lock-stale`, breaking more tests for a worse ordering.
- **`--json` plan output**: `do-work --json` already reports `model: settings.model ?? null`; effort is reported the
  same way (`effort: settings.effort ?? null`) so a scheduler can see the resolved value. Omitting it would make the
  JSON plan an incomplete description of the run it describes.
- **Dry-run header line**: the per-item header prints `Executor claude · model X`; the effort is appended to that same
  `modelNote` line rather than getting a row of its own, keeping the header's existing shape.
