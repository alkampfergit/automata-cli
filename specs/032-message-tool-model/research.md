# Phase 0 Research: message-driven executor and model

## Decision: a new pure module, `src/github/runDirective.ts`

**Decision**: Put parsing, trigger selection and precedence in one new pure module under
`src/github/`, and keep `doWork.ts` responsible only for wiring and for the marker refusal.

**Rationale**: `conversation.ts` and `workDetection.ts` established the pattern — the
safety-critical rules of the loop live in modules with no I/O so they can be exhaustively
unit-tested without a `gh` binary or a spawned executor. Precedence and "which message counts"
are exactly that kind of rule: cheap to get subtly wrong, expensive to notice on an unattended
loop. Inline in `doWork.ts` they would only be reachable through the full command mock stack.

**Alternatives considered**:

- *Inline in `doWork.ts`.* Rejected: `doWork.ts` is already 1250 lines, and the rules would
  only be testable through `parseAsync` with ten mocked modules.
- *Extend `conversation.ts`.* Rejected: that module is deliberately about the answer boundary
  and nothing else; adding executor selection to it mixes two concerns in the one file the
  detection tests treat as the specification of the boundary.
- *Extend `workDetection.ts` so `WorkItem` carries the directive.* Rejected: `WorkItem` is
  the output of the state machine, and the executor choice is not part of deciding whether
  work exists. It would also force every `WorkItem` fixture in the existing tests to change.

## Decision: resolve per work item, not per tick

**Decision**: `Settings.executor` / `Settings.model` stay as the *baseline*, and each item
computes a `ResolvedExecution` that the downstream call sites take as a parameter.

**Rationale**: a tick processes several issues, each with its own newest message and therefore
its own directive. A tick-wide value cannot express that. Passing the resolved value as a
parameter rather than mutating `Settings` per item keeps `Settings` immutable, which matters
because it is shared across items and `reportDryRun` describes several items at once.

**Alternatives considered**:

- *Mutate `settings` before each item and restore it after.* Rejected: an early `return` on
  any of the six skip paths in `processItem` would leak the previous item's executor into the
  next one — a silent, order-dependent bug on an unattended loop.
- *Build a fresh `Settings` clone per item.* Rejected: it would make every reader unable to
  tell which fields are per-tick and which are per-item, which is the distinction the feature
  turns on.

## Decision: last occurrence wins, matched anywhere, with a left-boundary guard

**Decision**: `/(?<![A-Za-z0-9_:-])tool:([A-Za-z0-9._-]+)/gi` and
`/(?<![A-Za-z0-9_:-])model:([A-Za-z0-9._/+@-]+)/gi`, taking the last match of each.

**Rationale**: the issue asked for "contains", so anchoring to a line start would not satisfy
it. The lookbehind is what stops `mytool:codex`, `no-tool:codex` and a URL fragment such as
`x:model:y` from being read as directives; a plain `\b` would not, because `-` to `t` is a
word boundary. Last-occurrence-wins is the natural reading of a person editing their own
comment and restating the value, and it is deterministic. Node 22 supports lookbehind
natively, so no polyfill or manual scan is needed.

**Alternatives considered**:

- *Line-anchored (`^tool:`)*. Rejected: contradicts the issue's "contains" wording, and the
  issue text itself writes the directive on its own line only incidentally.
- *First occurrence wins.* Rejected: a maintainer who corrects themselves later in the same
  comment would get the value they replaced.
- *Fenced-code-block awareness.* Rejected as premature (Principle V): it needs a markdown
  parser to do correctly, and the spec explicitly says the directive is not stripped from the
  prompt, so the model sees the same text either way.

## Decision: a `tool:` switch drops `--model`, a `model:` directive does not

**Decision**: when the directive selects an executor **different** from the one that would
otherwise run, `--model` is ignored and the model comes from `doWork.models.<new executor>`
(or nothing). When the directive names the same executor, or names no executor, `--model`
keeps its normal precedence.

**Rationale**: `doWork.models` is keyed per executor precisely because a Claude identifier is
not a valid Codex model. `--model` is chosen by an operator for the executor they expected to
run; carrying it across a switch would send a Claude identifier to Codex and produce an
executor-side error that reads as a broken tick rather than a bad combination. Restricting
the drop to an actual switch means a no-op `tool:claude` on an already-Claude run does not
silently discard the operator's flag.

**Alternatives considered**:

- *Always drop `--model` when `tool:` is present.* Rejected: surprising for a no-op directive,
  and it makes the rule harder to state than the hazard it guards against.
- *Never drop it — message > `--model` means `--model` survives when the message is silent on
  the model.* Rejected: it reintroduces exactly the cross-executor identifier the per-executor
  `doWork.models` design exists to prevent.

## Decision: refuse an invalid `tool:` after the marker, as `failed`

**Decision**: validate the directive at the same pre-flight point as
`describeOversizedPrompt` — after `postMarker` and after the prompt is composed — and refuse
by updating the marker, returning a `failed` `ItemReport` without `ranExecutor`.

**Rationale**: the marker is what holds the answer boundary. Refusing before it exists would
leave the mistyped message permanently "new", so every tick forever would re-refuse it and
post a fresh comment. Updating the marker keeps its creation time, which advances the
boundary once and leaves a single durable explanation the maintainer can reply to. `failed`
(exit 2) rather than `skipped` follows the oversized-prompt precedent and is honest: the item
was actionable and produced no answer. Not setting `ranExecutor` means the run cap is
untouched, which is correct — no model run happened.

**Alternatives considered**:

- *Fall back to the default executor with a warning.* Rejected outright by the issue
  discussion, and it is the failure mode this codebase is built to avoid: the maintainer would
  read a Claude answer as a Codex answer.
- *Refuse the whole tick.* Rejected: one maintainer's typo on one issue must not stop the
  other issues from being answered (FR-011).
- *Refuse before checking out the branch, without a marker.* Rejected for the boundary reason
  above.

## Decision: validate `model:` not at all

**Decision**: pass the `model:` value through unchanged.

**Rationale**: automata does not and cannot hold the model catalogue of either executor —
both publish new identifiers continuously, and both accept aliases. A local allow-list would
be wrong within weeks and would block a legitimate new model. The executor's own rejection is
an ordinary run failure, which the marker reconciliation already reports usefully.

**Alternatives considered**:

- *A regex sanity check on the shape.* Rejected: the character class in the parser already
  bounds what can be captured; anything beyond that is guessing at vendors' naming.
- *Query the executor for its model list.* Rejected: an extra subprocess per item for no
  benefit the run failure does not already provide.

## Decision: name the executor and model on every summary line

**Decision**: the human summary always appends the effective executor and model to each item
line, and adds `— from the message` when the directive supplied either.

**Rationale**: FR-014 asks for the effective values to be named. An unconditional field is
greppable in a cron log; a conditional one means the absence of the field is ambiguous
between "no directive" and "an older automata". The `— from the message` suffix is what makes
an unexpected cost or an unexpected answer style traceable to a comment.

**Alternatives considered**:

- *Print it only when a directive was used.* Rejected for the ambiguity above.
- *A separate line per item.* Rejected: it doubles the length of the summary, which is the
  part that lands in cron mail.

## Autonomous Decisions

Every decision above was taken without user input; the issue discussion confirmed points 1, 3
and 5 of the proposed behaviour (scope of reading, precedence, invalid-`tool:` refusal) and
excluded `implement-next`. The remaining choices — module placement, per-item vs per-tick
resolution, the regex guard, the `--model` drop rule, and the summary format — were resolved
against the existing code and the constitution as recorded in each section.
