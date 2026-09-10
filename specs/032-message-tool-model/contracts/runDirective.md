# Contract: `src/github/runDirective.ts`

Pure. Imports only types from `src/config/configStore.js`, `src/github/conversation.js` and
`src/github/workDetection.js`. No commander, no `gh`, no `git`, no `child_process`.

```ts
export interface RunDirective {
  tool: string | undefined;   // lower-cased; may be invalid
  model: string | undefined;  // original case; never validated
}

export type ExecutionSource = "message" | "option" | "config" | "default";

export interface ResolvedExecution {
  executor: Executor;
  executorSource: ExecutionSource;
  model: string | undefined;
  modelSource: ExecutionSource | "none";
}

export type ResolveExecutionResult =
  | ({ ok: true } & ResolvedExecution)
  | { ok: false; invalidTool: string };

export interface ResolveExecutionInput {
  directive: RunDirective;
  withOption?: Executor | undefined;
  modelOption?: string | undefined;
  configExecutor?: Executor | undefined;
  configModels?: Partial<Record<Executor, string>> | undefined;
}

/** The newest authorized message this turn is answering, or null if there is none. */
export function triggeringMessage(item: WorkItem): RawMessage | null;

/** Read `tool:` / `model:` out of one message body. Last occurrence of each wins. */
export function parseRunDirective(body: string): RunDirective;

/** Apply the precedence chain. */
export function resolveExecution(input: ResolveExecutionInput): ResolveExecutionResult;

/** The two values a `tool:` directive may take, for error messages. */
export const VALID_TOOLS: readonly Executor[];

/** One-line human rendering, e.g. `codex · model gpt-5-codex — from the message`. */
export function describeExecution(execution: ResolvedExecution): string;
```

## Behavioural contract

### `triggeringMessage`

- `issue-discuss` → newest of `item.issueAnalysis.newMessages`.
- `pr-work` → newest of `item.prAnalysis?.newMessages`, the authorized comments of
  `item.actionableThreads` newer than `item.prAnalysis?.lastAgentAt`, and
  `item.issueAnalysis.newMessages`.
- Returns `null` only when every one of those is empty, which the detection rules make
  unreachable for a real `WorkItem`; the caller treats `null` as "no directive".
- Never mutates the item.

### `parseRunDirective`

| Input | `tool` | `model` |
|---|---|---|
| `"tool:codex"` | `"codex"` | `undefined` |
| `"TOOL:CODEX"` | `"codex"` | `undefined` |
| `"use tool:codex please"` | `"codex"` | `undefined` |
| `"tool:claude ... tool:codex"` | `"codex"` | `undefined` |
| `"model:GPT-5-Codex"` | `undefined` | `"GPT-5-Codex"` |
| `"tool:codex model:o3"` | `"codex"` | `"o3"` |
| `"mytool:codex"` | `undefined` | `undefined` |
| `"no-tool:codex"` | `undefined` | `undefined` |
| `"tool:codexx"` | `"codexx"` | `undefined` |
| `"tool:"` | `undefined` | `undefined` |
| `""` | `undefined` | `undefined` |

### `resolveExecution`

Follows the two precedence tables in `data-model.md` exactly. Returns
`{ ok: false, invalidTool }` if and only if `directive.tool` is set and is neither `claude`
nor `codex`; in that case no other field is computed.
