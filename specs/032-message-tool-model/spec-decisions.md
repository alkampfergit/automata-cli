# Spec Decisions: Choose the executor and model from the triggering message

**Branch**: `feature/032-message-tool-model`
**Date**: 2026-09-10
**Spec**: [specs/032-message-tool-model/spec.md](spec.md)
**Plan**: [specs/032-message-tool-model/plan.md](plan.md)
**Research**: [specs/032-message-tool-model/research.md](research.md)

## Planning Decisions

- **Where the rules live**: a new pure module `src/github/runDirective.ts` holding parsing,
  trigger selection and precedence; `doWork.ts` keeps only the wiring and the marker refusal.
  **Rationale**: `conversation.ts` and `workDetection.ts` established that the loop's
  safety-critical rules live in I/O-free modules so they can be exhaustively unit-tested
  without a `gh` binary or a spawned executor, and precedence is exactly that kind of rule.
  **Alternatives considered**: inline in the already 1250-line `doWork.ts` (only reachable
  through ten mocked modules); extending `conversation.ts` (mixes executor selection into the
  file that documents the answer boundary); putting the directive on `WorkItem` in
  `workDetection.ts` (the executor choice is not part of deciding whether work exists, and it
  would churn every existing fixture).

- **Per-item, not per-tick, resolution**: `Settings` keeps the baseline; each item computes a
  `ResolvedExecution` that `planRun`, `describePlannedRun` and `invokeExecutor` take as a
  parameter. **Rationale**: a tick processes several issues, each with its own newest message
  and therefore its own directive; a tick-wide value cannot express that, and an immutable
  `Settings` keeps `reportDryRun` — which describes several items at once — correct.
  **Alternatives considered**: mutating `settings` per item and restoring it (any of the six
  early `return`s in `processItem` would leak the previous item's executor into the next — a
  silent, order-dependent bug on an unattended loop); cloning `Settings` per item (erases the
  per-tick/per-item distinction the feature turns on).

- **Directive syntax**: two global case-insensitive regexes with a `(?<![A-Za-z0-9_:-])`
  left-boundary guard, last occurrence of each key winning. **Rationale**: the issue asked for
  "contains", so line anchoring would not satisfy it; the lookbehind is what stops
  `mytool:codex` and `no-tool:codex` being read as directives, which a plain `\b` would not
  since `-` to `t` is a word boundary; last-wins matches a person restating a value later in
  their own comment. **Alternatives considered**: line-anchored `^tool:` (contradicts the
  issue's wording); first-occurrence-wins (a self-correction would lose to the value it
  replaced); fenced-code-block awareness (needs a markdown parser, and the directive is not
  stripped from the prompt anyway, so the model sees the same text either way).

- **A `tool:` switch drops `--model`; a same-executor or model-only directive does not**.
  **Rationale**: `doWork.models` is keyed per executor precisely because a Claude identifier
  is not a valid Codex model; `--model` is chosen by an operator for the executor they
  expected, so carrying it across a switch would send a Claude identifier to Codex and
  produce an executor-side error that reads as a broken tick. **Alternatives considered**:
  always dropping `--model` when `tool:` is present (surprising for a no-op directive);
  never dropping it (reintroduces the cross-executor identifier the per-executor
  `doWork.models` design exists to prevent).

- **An invalid `tool:` refuses the item after the marker is posted, reported as `failed`**.
  **Rationale**: the marker is what holds the answer boundary — refusing before it exists
  would leave the mistyped message permanently new, so every tick forever would re-refuse it
  and post a fresh comment; updating the marker advances the boundary once and leaves a
  single durable explanation. `failed` (exit 2) follows `describeOversizedPrompt`, the closest
  existing pre-flight refusal, and not setting `ranExecutor` correctly leaves the run cap
  untouched. **Alternatives considered**: silently falling back to the default (rejected in
  the issue discussion, and the maintainer would read a Claude answer as a Codex answer);
  refusing the whole tick (one typo must not stop the other issues); refusing before the
  marker (the boundary problem above).

- **`model:` is never validated**. **Rationale**: automata cannot hold either executor's model
  catalogue — both publish new identifiers continuously and both accept aliases — so a local
  allow-list would be wrong within weeks and would block a legitimate new model. The
  executor's own rejection is an ordinary run failure the marker reconciliation already
  reports. **Alternatives considered**: a shape regex (the parser's character class already
  bounds what can be captured); querying the executor for its model list (an extra subprocess
  per item for no benefit).

- **The tick summary names the executor and model on every line**, adding `— from the
  message` only when a directive supplied one. **Rationale**: an unconditional field is
  greppable in a cron log, whereas a conditional one makes the field's absence ambiguous
  between "no directive" and "an older automata". **Alternatives considered**: printing it
  only when a directive was used (the ambiguity above); a separate line per item (doubles the
  length of the part that lands in cron mail).

- **Project structure**: `runDirective.ts` sits beside `conversation.ts` and
  `workDetection.ts` in the existing flat `src/github/` layout. **Rationale**: it consumes
  `RawMessage` and `WorkItem` and, like them, is pure. **Alternatives considered**:
  `src/commands/` (untestable without commander); a new top-level directory for one module
  (violates the constitution's Simplicity principle).
