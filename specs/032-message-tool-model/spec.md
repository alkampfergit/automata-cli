# Feature Specification: Choose the executor and model from the triggering message

**Feature Branch**: `feature/032-message-tool-model`

**Created**: 2026-09-10

**Status**: Draft

**Input**: GitHub issue #50 — "If latest user message contains `model:xxxc` you will execute with that model. If it contains `tool:codex` it will use codex."

## Clarifications

### Session 2026-09-10 (autonomous)

- Q: On a `pr-work` turn, which surface supplies the directive? → A: the newest authorized
  message among *all* surfaces the turn answers — pull-request comments, review bodies,
  unresolved review-thread comments, and the issue comments that triggered the turn.
  [AUTO: a build turn can be triggered by an issue message alone (`hasPrWork === false &&
  issueAnalysis.hasNewMessage`), so restricting to the pull request would leave that case
  with no directive at all.]
- Q: Does the issue **description** count as a message that can carry a directive? → A: yes,
  on the first tick. [AUTO: `analyzeSurface` already marks the issue body `isNew` when the
  agent has never spoken, and the existing detection rules treat it as a trigger; excluding
  it here would make the directive silently inert on exactly the first turn, which is where
  a maintainer is most likely to write it.]
- Q: When `tool:` switches the executor and `--model` was given on the command line, which
  model wins? → A: neither the message nor `--model` — the switch drops `--model` and falls
  to `doWork.models.<new executor>`, else nothing. [AUTO: same reasoning as the existing
  per-executor `doWork.models` design; a Claude identifier is not a valid Codex model, and
  passing it through would produce a confusing executor-side error instead of a working run.]
- Q: Where in the item pipeline does an invalid `tool:` refuse? → A: after the working marker
  is posted, at the same point as the oversized-prompt refusal, updating that marker with the
  explanation. [AUTO: the marker holds the answer boundary; refusing before it would refuse
  the same message again on every subsequent tick, with a new explanation each time.]
- Q: What outcome and exit code does a refused item produce? → A: `failed`, so the tick exits
  2. [AUTO: matches `describeOversizedPrompt`, the closest existing precedent, and an
  unattended loop must not report a healthy tick when an item was refused.]

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pick the executor from the message (Priority: P1)

An authorized maintainer is discussing an issue with the agent and decides this particular
turn is better handled by Codex than by the configured default. They write `tool:codex`
somewhere in their comment and post it. The next `do-work` tick answers that message with
Codex. Their following comment carries no directive, so that turn runs with the configured
default again.

**Why this priority**: This is the core of the request — steering the executor per turn
without a config change, a redeploy, or shell access to the harness machine.

**Independent Test**: Post a comment containing `tool:codex` on an issue whose configured
executor is Claude, run one tick, and observe that the Codex runner is invoked. Post a
comment without a directive and observe Claude.

**Acceptance Scenarios**:

1. **Given** `doWork.executor` is `claude`, **When** the newest authorized message contains
   `tool:codex`, **Then** the run for that item is executed with Codex.
2. **Given** `doWork.executor` is `codex`, **When** the newest authorized message contains
   `tool:claude`, **Then** the run for that item is executed with Claude.
3. **Given** a previous message contained `tool:codex` and the newest one does not,
   **When** the tick runs, **Then** the run uses the configured/CLI default, not Codex.
4. **Given** the message contains `TOOL:CODEX`, **When** the tick runs, **Then** it is
   recognised — matching is case-insensitive.

---

### User Story 2 - Pick the model from the message (Priority: P1)

The same maintainer wants one turn answered by a specific model — a larger one for a hard
design question, a cheaper one for a trivial edit. They write `model:<id>` in the comment
and the next tick passes that identifier to the executor.

**Why this priority**: Half of the request, and independently useful: model steering is the
more frequent need, since the executor rarely changes.

**Independent Test**: Post a comment containing `model:some-model`, run one tick with
`--dry-run`, and observe `some-model` in the argv that would be launched.

**Acceptance Scenarios**:

1. **Given** no `--model` and no `doWork.models`, **When** the newest authorized message
   contains `model:gpt-5-codex`, **Then** the executor is invoked with that model identifier.
2. **Given** `doWork.models.claude` is set, **When** the newest authorized message contains
   `model:other-id`, **Then** `other-id` is used, not the configured one.
3. **Given** the message contains `model:a` and later `model:b`, **When** the tick runs,
   **Then** `b` is used — the last occurrence wins.
4. **Given** the message contains a model identifier the executor does not recognise,
   **When** the tick runs, **Then** automata passes it through unchanged and the executor's
   own rejection surfaces as an ordinary run failure.

---

### User Story 3 - See which executor and model actually ran (Priority: P2)

An operator reading the tick summary, or inspecting a tick with `--dry-run`, can see which
executor and model each item used and whether that came from the message rather than from
the configuration.

**Why this priority**: Without it, a maintainer who typo'd a directive, or an operator
debugging an unexpected cost, cannot tell what happened from the output.

**Independent Test**: Run `--dry-run` on an issue whose newest message carries a directive
and read the per-item header; run a real tick and read the summary line.

**Acceptance Scenarios**:

1. **Given** the newest message contains `tool:codex`, **When** `--dry-run` is used, **Then**
   the item header names Codex and says the choice came from the message.
2. **Given** no directive, **When** `--dry-run` is used, **Then** the item header names the
   effective executor and model without claiming a message origin.
3. **Given** `--json`, **When** the tick runs, **Then** each item and each planned run carries
   the effective executor, the effective model, and where each came from.

---

### User Story 4 - A mistyped executor stops the run instead of guessing (Priority: P2)

A maintainer writes `tool:codexx`. Rather than silently running the default and producing an
answer the maintainer will misread as coming from Codex, automata refuses that item, says so
on the surface it was going to answer, and lists the values it accepts.

**Why this priority**: A silent fallback on an unattended loop is the failure mode this whole
codebase is built to avoid; but it is a guard rail, not the value the feature delivers.

**Independent Test**: Post `tool:codexx`, run one tick, and observe that no executor is
invoked, the marker comment explains the problem, and the tick exits degraded.

**Acceptance Scenarios**:

1. **Given** the newest message contains `tool:codexx`, **When** the tick runs, **Then** no
   executor is invoked for that item.
2. **Given** the same, **When** the tick runs, **Then** the marker comment on the answering
   surface says the value is not recognised and names `claude` and `codex` as the valid ones.
3. **Given** the same, **When** the tick runs, **Then** the item is reported as `failed` and
   the tick exits 2.
4. **Given** the same, **When** the tick runs, **Then** other items in the same tick are
   unaffected.

---

### Edge Cases

- **Directive in an older message only** — ignored. Only the newest authorized message that
  triggers the turn is read, so a directive never persists across ticks.
- **Both `tool:` and `model:` present** — both apply.
- **`tool:` present, `model:` absent** — the model default for the *newly selected* executor
  is used, never a model identifier chosen for a different executor.
- **The same directive key repeated** — the last occurrence in the message body wins.
- **`tool:` appears as part of a longer word** (`notool:codex`, `mytool:codex`) — not a
  directive; the token must not be preceded by a word character or a hyphen.
- **A pull-request turn** — the directive is read from the newest authorized message that
  triggers the turn, wherever it is: a pull-request comment, a review body, an unresolved
  review-thread comment, or the issue comment that caused the build turn.
- **A directive in a message from an unauthorized account** — never seen; those messages are
  already filtered out before detection and never reach a prompt.
- **`implement-next`** — out of scope, explicitly. It is not message-driven.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `do-work` MUST read an executor directive of the form `tool:<value>` and a model
  directive of the form `model:<value>` from the body of the newest authorized message that
  triggers a work item's turn.
- **FR-002**: Directive keys and the `tool:` value MUST be matched case-insensitively. A
  `model:` value MUST be passed through with its original case.
- **FR-003**: A directive MUST be recognised anywhere in the message body, not only at the
  start of a line.
- **FR-004**: When a directive key appears more than once in the same body, the last
  occurrence MUST win.
- **FR-005**: A token MUST NOT be treated as a directive when the key is preceded by a word
  character, a hyphen, or a colon (so `mytool:codex` and `no-tool:codex` are inert).
- **FR-006**: The precedence for the executor MUST be: message directive, then `--with`, then
  `doWork.executor`, then `claude`.
- **FR-007**: The precedence for the model MUST be: message directive, then `--model`, then
  `doWork.models.<effective executor>`, then nothing (the executor picks its own).
- **FR-008**: When the message directive changes the executor away from the one that would
  otherwise have run, `--model` MUST be ignored and the model MUST come from
  `doWork.models.<new executor>` (or nothing), because a model identifier chosen for one
  executor is not valid for the other.
- **FR-009**: A `model:` value MUST NOT be validated by automata. It is passed to the
  executor unchanged, and the executor's rejection surfaces as an ordinary run failure.
- **FR-010**: A `tool:` value other than `claude` or `codex` MUST refuse the run for that
  work item: no executor is invoked, the marker comment on the answering surface is updated
  to say the value is not recognised and which values are valid, and the item is reported as
  `failed`.
- **FR-011**: A refused item MUST NOT prevent the other items in the same tick from running,
  and MUST NOT consume a slot from the run cap, because no model run took place.
- **FR-012**: The directive MUST NOT be stripped from the conversation handed to the
  executor.
- **FR-013**: The directive MUST NOT persist. Each tick re-reads the newest triggering message
  and a message without a directive resolves to the ordinary defaults.
- **FR-014**: The human tick summary MUST name the effective executor and model per item, and
  MUST say when either came from the message.
- **FR-015**: The `--dry-run` item header MUST name the effective executor and model and say
  when either came from the message; the command it prints MUST be built with the same argv
  builders the real invocation uses, as it is today.
- **FR-016**: `--json` output MUST carry the effective executor, the effective model, and the
  origin of each, for both planned runs (`--dry-run`) and completed items.
- **FR-017**: `implement-next` MUST be unchanged.

### Key Entities

- **Run directive**: what one message body asks for — an optional executor and an optional
  model, each with the raw text as written so an invalid value can be quoted back.
- **Resolved execution**: the executor and model one work item will actually use, each paired
  with where it came from (`message`, `option`, `config`, or `default`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A maintainer can change the executor for a single turn by editing nothing but
  the text of their comment — no config file change, no CLI flag, no access to the harness
  machine.
- **SC-002**: A directive affects exactly one turn: the tick after the message that carries it,
  and no later tick.
- **SC-003**: Every completed item's effective executor and model is readable from the tick
  summary without re-deriving it from the configuration.
- **SC-004**: A mistyped `tool:` value never results in a run under a different executor than
  the one asked for; 100% of such items are refused with an explanation on the surface.
- **SC-005**: No existing `do-work` behaviour changes for a message that carries no directive —
  the whole existing test suite passes unmodified.

## Assumptions

- [AUTO] **Where the directive is read from on a build turn**: the newest authorized message
  among all the surfaces the turn answers (pull-request comments and reviews, unresolved
  review-thread comments, and the issue comments that triggered it). Chosen because a build
  turn can be triggered by an issue message alone, and "the message that triggered this turn"
  is the only definition that covers every case the detection rules already produce.
- [AUTO] **`--model` is dropped only when the directive changes the executor**: a
  `tool:claude` directive on an already-Claude run leaves `--model` in force. Chosen because
  the hazard FR-008 addresses is a cross-executor identifier, and dropping an operator's flag
  for a no-op directive would be surprising.
- [AUTO] **Refusal happens after the marker is posted**, matching the existing
  oversized-prompt refusal. Chosen because the marker is what holds the answer boundary: a
  refusal before it would leave the mistyped message "new" forever and refuse it again on
  every tick, instead of once with an explanation.
- [AUTO] **A refused item is `failed` (exit 2), not `skipped`**. Chosen because
  `describeOversizedPrompt` — the closest existing precedent, also a pre-flight refusal after
  the marker — reports `failed`, and an unattended loop must surface it.
- [AUTO] **Directive value character set**: `tool:` takes letters, digits, `.`, `_` and `-`;
  `model:` additionally takes `/`, `+` and `@`. Chosen to cover published Claude, Codex and
  vendor-prefixed identifiers while stopping at surrounding punctuation and markdown.
- [AUTO] **The tick summary always names the executor and model**, adding the origin only
  when it is the message. Chosen because FR-014 asks for the effective values to be named,
  and an always-present field is easier to grep in a log than a conditional one.
- [AUTO] **No config key is added.** Chosen because the feature is a per-message override of
  existing keys; there is nothing new to persist. This also keeps the wizard untouched.
- Existing behaviour depended on: authorized-account filtering already runs before detection,
  so an unauthorized account's directive is unreachable by construction and needs no separate
  guard.
