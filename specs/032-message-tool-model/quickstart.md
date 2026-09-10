# Quickstart: steering one turn from a message

## Change the executor for one turn

Comment on the issue (or on its pull request):

```text
This one needs a second opinion — tool:codex

Please rework the retry logic so it backs off exponentially.
```

The next `do-work` tick answers that message with Codex. Your next comment, with no
directive, goes back to whatever `doWork.executor` / `--with` says.

## Change the model for one turn

```text
model:claude-opus-4-6

Have another go at the migration plan.
```

## Both at once

```text
tool:codex model:gpt-5-codex — take another pass at the parser.
```

## Check it before it runs

```bash
automata do-work --issue 50 --dry-run
```

```text
  Executor     codex · model gpt-5-codex — from the message
```

and, machine-readably:

```bash
automata do-work --issue 50 --dry-run --json | jq '.runs[] | {executor, model, executorSource, modelSource}'
```

```json
{ "executor": "codex", "model": "gpt-5-codex", "executorSource": "message", "modelSource": "message" }
```

## Read it after it ran

```text
Tick summary:
  #50 issue-discuss answered — answered · codex · model gpt-5-codex — from the message
```

## What a typo does

```text
tool:codexx
```

```text
Tick summary:
  #50 issue-discuss failed — the message asks for tool:codexx, which is not a known executor
```

Nothing is invoked, and the `working…` marker on the issue is replaced with:

> automata do-work: the newest message asks for `tool:codexx`, which is not an executor
> automata knows. Valid values are `claude` and `codex`. No run was started. Reply here with
> a corrected directive, or none at all, to have another attempt made.

The tick exits 2 and the other issues in it are unaffected.

## Rules worth knowing

- Only the **newest** authorized message the turn is answering is read. A directive never
  carries over to the next tick.
- Matching is case-insensitive and works anywhere in the body; the **last** occurrence of a
  key wins.
- `tool:` without `model:` uses `doWork.models.<the executor you asked for>` — never a model
  identifier configured for the other executor, and never a `--model` passed on the command
  line for the other executor.
- `model:` is never validated. If the executor rejects it, that is an ordinary run failure.
- The directive stays in the text the model receives; it is not stripped.
- `automata implement-next` does not read directives.
