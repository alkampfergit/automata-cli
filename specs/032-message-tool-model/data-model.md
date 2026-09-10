# Phase 1 Data Model: message-driven executor and model

No persisted data. Everything below is in-memory, derived per work item from messages the
tick has already fetched.

## `RunDirective`

What one message body asks for.

| Field | Type | Meaning |
|---|---|---|
| `tool` | `string \| undefined` | The `tool:` value, lower-cased. **May be invalid** — validation belongs to the resolver, so the raw text survives for the error message. |
| `model` | `string \| undefined` | The `model:` value, original case preserved. Never validated. |

An absent directive is `{ tool: undefined, model: undefined }`, not `null`, so callers never
branch on nullability before reading a field.

## `ExecutionSource`

Where an effective value came from. `"message" | "option" | "config" | "default"`.

- `message` — a directive in the newest triggering message.
- `option` — `--with` / `--model` on the command line.
- `config` — `doWork.executor` / `doWork.models.<executor>`.
- `default` — the built-in `claude` (executor only; the model has no built-in default).

## `ResolvedExecution`

What one work item will actually run with.

| Field | Type | Meaning |
|---|---|---|
| `executor` | `Executor` (`"claude" \| "codex"`) | The executor to spawn. |
| `executorSource` | `ExecutionSource` | Where it came from. |
| `model` | `string \| undefined` | The model identifier to pass, or `undefined` to let the executor choose. |
| `modelSource` | `ExecutionSource \| "none"` | Where it came from; `"none"` when there is no model override. |
| `effort` | `string \| undefined` | The reasoning effort level to pass, or `undefined` to let the executor choose. |
| `effortSource` | `Exclude<ExecutionSource, "message" \| "default"> \| "none"` | Where it came from. Never `message` — no directive names a level — and never `default`, since there is no built-in level. |

## `ResolveExecutionResult`

The resolver's return, discriminated on `ok`.

```text
{ ok: true } & ResolvedExecution
| { ok: false; invalidTool: string }
```

`invalidTool` carries the value exactly as the resolver saw it (lower-cased), so the marker
comment can quote it back to the maintainer.

## `ResolveExecutionInput`

| Field | Type | Meaning |
|---|---|---|
| `directive` | `RunDirective` | From the newest triggering message. |
| `withOption` | `Executor \| undefined` | `--with`, already validated by the command. |
| `modelOption` | `string \| undefined` | `--model`, never validated. |
| `configExecutor` | `Executor \| undefined` | `doWork.executor`. |
| `configModels` | `DoWorkModels \| undefined` | `doWork.models`. |
| `effortOption` | `string \| undefined` | `--effort`, already trimmed and rejected-if-empty by the command. |
| `configEfforts` | `DoWorkEffort \| undefined` | `doWork.effort`. |
| `defaultExecutor` | `Executor` | The built-in fallback, passed in rather than duplicated from `DEFAULT_DO_WORK`. Required. |

## Precedence, as a table

The executor:

| `tool:` | `--with` | `doWork.executor` | Result | `executorSource` |
|---|---|---|---|---|
| valid | any | any | the directive | `message` |
| absent | set | any | `--with` | `option` |
| absent | unset | set | config | `config` |
| absent | unset | unset | `claude` | `default` |
| invalid | any | any | refused | — |

The model, given the executor resolved above:

| `model:` | executor switched by `tool:` | `--model` | `doWork.models.<executor>` | Result | `modelSource` |
|---|---|---|---|---|---|
| set | any | any | any | the directive | `message` |
| absent | yes | any | set | config for the **new** executor | `config` |
| absent | yes | any | unset | none | `none` |
| absent | no | set | any | `--model` | `option` |
| absent | no | unset | set | config | `config` |
| absent | no | unset | unset | none | `none` |

The effort, given the same resolved executor. No directive can name a level, so the only
thing a message changes is *which* executor's level applies:

| executor switched by `tool:` | `--effort` | `doWork.effort.<executor>` | Result | `effortSource` |
|---|---|---|---|---|
| yes | any | set | config for the **new** executor | `config` |
| yes | any | unset | none | `none` |
| no | set | any | `--effort` | `option` |
| no | unset | set | config | `config` |
| no | unset | unset | none | `none` |

A configured level is trimmed, and a whitespace-only one is treated as unset: config
validation only rejects an empty level, and neither executor reports an unknown one.

"Switched" means the directive named an executor different from the one `--with` / config /
default would have produced.

## `ItemReport` additions

| Field | Type | Meaning |
|---|---|---|
| `execution` | `ResolvedExecution \| undefined` | Present once the item got far enough to resolve one. Absent for an item skipped before that point. |

Reported in the summary line and in `--json`.
