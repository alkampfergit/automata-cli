import type { DoWorkModels, Executor } from "../config/configStore.js";
import type { RawMessage } from "./conversation.js";
import type { WorkItem } from "./workDetection.js";

/**
 * Letting the newest authorized message pick the executor and the model for the
 * turn it triggers.
 *
 * Pure by design, like `conversation.ts` and `workDetection.ts`: which message
 * counts, and which of four possible sources wins, are cheap rules to get subtly
 * wrong and expensive to notice on an unattended loop. Keeping them free of I/O
 * makes them exhaustively testable without a `gh` binary or a spawned executor.
 *
 * Nothing here persists. Every tick re-reads whichever message is newest then,
 * so a directive steers exactly the turn it appears in.
 */

/** The two values a `tool:` directive may take. */
export const VALID_TOOLS: readonly Executor[] = ["claude", "codex"];

/** What one message body asks for. Absent fields mean "did not say". */
export interface RunDirective {
  /** The `tool:` value, lower-cased. May be invalid — `resolveExecution` judges it. */
  tool: string | undefined;
  /** The `model:` value, original case. Never validated: see `resolveExecution`. */
  model: string | undefined;
}

/** Where an effective value came from, for the summary and for `--json`. */
export type ExecutionSource = "message" | "option" | "config" | "default";

/** What one work item will actually run with. */
export interface ResolvedExecution {
  executor: Executor;
  executorSource: ExecutionSource;
  model: string | undefined;
  /** "none" when there is no model override and the executor picks its own. */
  modelSource: ExecutionSource | "none";
}

export type ResolveExecutionResult =
  ({ ok: true } & ResolvedExecution) | { ok: false; invalidTool: string };

export interface ResolveExecutionInput {
  directive: RunDirective;
  /** `--with`, already validated by the command. */
  withOption?: Executor | undefined;
  /** `--model`, never validated. */
  modelOption?: string | undefined;
  configExecutor?: Executor | undefined;
  configModels?: DoWorkModels | undefined;
  /** The built-in fallback, passed in rather than duplicated from `DEFAULT_DO_WORK`. */
  defaultExecutor: Executor;
}

/**
 * The left-hand guard is a lookbehind rather than `\b`, because `\b` sits
 * between `-` and `t` — so `no-tool:codex` and a `x:model:y` fragment would both
 * read as directives. Only a value directly after the colon is captured: a
 * `tool:` followed by whitespace is a person trailing off, not a request to run
 * whatever word comes next.
 */
const TOOL_PATTERN = /(?<![A-Za-z0-9_:-])tool:([A-Za-z0-9._-]+)/gi;
/** `/`, `+` and `@` too, for vendor-prefixed and dated model identifiers. */
const MODEL_PATTERN = /(?<![A-Za-z0-9_:-])model:([A-Za-z0-9._/+@-]+)/gi;

/** The last match of a global pattern, or undefined when it never matched. */
function lastCapture(body: string, pattern: RegExp): string | undefined {
  // `matchAll` needs its own lastIndex, and the patterns are module-level
  // constants shared across calls; a fresh RegExp avoids the stateful footgun.
  const matches = [...body.matchAll(new RegExp(pattern.source, pattern.flags))];
  return matches.at(-1)?.[1];
}

/**
 * Read `tool:` / `model:` out of one message body.
 *
 * Matched anywhere, not line-anchored: the request was "contains". The last
 * occurrence of each key wins, so someone who restates a value later in the same
 * comment gets the value they finished with rather than the one they replaced.
 */
export function parseRunDirective(body: string): RunDirective {
  const tool = lastCapture(body, TOOL_PATTERN);
  return {
    tool: tool === undefined ? undefined : tool.toLowerCase(),
    model: lastCapture(body, MODEL_PATTERN),
  };
}

function newest(messages: RawMessage[]): RawMessage | null {
  let found: RawMessage | null = null;
  for (const message of messages) {
    // `>=` so a later entry wins a tie: the arrays are appended in surface
    // order, and two authorized messages in the same second are not worth
    // ranking beyond "deterministic".
    if (found === null || message.createdAt >= found.createdAt) found = message;
  }
  return found;
}

/**
 * The newest authorized message this turn is answering.
 *
 * A build turn can be triggered by a pull request comment, by an unresolved
 * review thread, *or* by an issue comment alone — so restricting to the pull
 * request would leave the last of those with no directive at all. All three are
 * considered and the newest wins, which is the only definition that covers every
 * case the detection rules can produce.
 *
 * Returns null only when nothing is new, which `decideWork` makes unreachable
 * for a real work item; callers read null as "no directive".
 */
export function triggeringMessage(item: WorkItem): RawMessage | null {
  if (item.turn === "issue-discuss") return newest(item.issueAnalysis.newMessages);

  const prLastAgentAt = item.prAnalysis?.lastAgentAt ?? null;
  const threadComments = item.actionableThreads.flatMap((thread) =>
    // The thread's comments are already filtered to authorized and agent
    // accounts; the agent's own are not a trigger, and anything the agent has
    // since answered is not either.
    thread.comments.filter(
      (comment) => prLastAgentAt === null || comment.createdAt > prLastAgentAt,
    ),
  );

  return newest([
    ...item.issueAnalysis.newMessages,
    ...(item.prAnalysis?.newMessages ?? []),
    ...threadComments,
  ]);
}

function isExecutor(value: string): value is Executor {
  return VALID_TOOLS.includes(value as Executor);
}

/**
 * Apply the precedence chain: message directive, then the command line, then
 * `doWork`, then the built-in default.
 *
 * The one wrinkle is the model when the directive *switches* executor without
 * naming a model. `--model` was chosen by an operator for the executor they
 * expected to run, and a Claude identifier is not a valid Codex model — the same
 * reason `doWork.models` is keyed per executor. So a switch drops `--model` and
 * falls to the new executor's configured default, or to nothing. A directive
 * naming the executor that was going to run anyway changes nothing, so it must
 * not discard the operator's flag.
 */
export function resolveExecution(input: ResolveExecutionInput): ResolveExecutionResult {
  const { directive, withOption, modelOption, configExecutor, configModels } = input;

  if (directive.tool !== undefined && !isExecutor(directive.tool)) {
    return { ok: false, invalidTool: directive.tool };
  }

  const baseline: Executor = withOption ?? configExecutor ?? input.defaultExecutor;
  const baselineSource: ExecutionSource =
    withOption !== undefined ? "option" : configExecutor !== undefined ? "config" : "default";

  const executor: Executor = directive.tool ?? baseline;
  const executorSource: ExecutionSource = directive.tool === undefined ? baselineSource : "message";
  const switched = directive.tool !== undefined && directive.tool !== baseline;

  if (directive.model !== undefined) {
    return { ok: true, executor, executorSource, model: directive.model, modelSource: "message" };
  }

  const configModel = configModels?.[executor];
  if (!switched && modelOption !== undefined) {
    return { ok: true, executor, executorSource, model: modelOption, modelSource: "option" };
  }
  if (configModel !== undefined) {
    return { ok: true, executor, executorSource, model: configModel, modelSource: "config" };
  }
  return { ok: true, executor, executorSource, model: undefined, modelSource: "none" };
}

/**
 * One-line rendering, shared by the dry-run header and the tick summary so the
 * two cannot describe the same run differently.
 */
export function describeExecution(execution: ResolvedExecution): string {
  const model =
    execution.model === undefined ? " (no model override)" : ` · model ${execution.model}`;
  const fromMessage =
    execution.executorSource === "message" || execution.modelSource === "message"
      ? " — from the message"
      : "";
  return `${execution.executor}${model}${fromMessage}`;
}

/** What the marker comment says when a `tool:` value is not an executor. */
export function describeInvalidTool(invalidTool: string): string {
  return (
    `the newest message asks for \`tool:${invalidTool}\`, which is not an executor automata knows ` +
    `(valid values are ${VALID_TOOLS.map((tool) => `\`${tool}\``).join(" and ")})`
  );
}
