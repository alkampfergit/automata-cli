import type { DoWorkEffort, DoWorkModels, Executor } from "../config/configStore.js";
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
  /**
   * The reasoning effort level. No `effort:` directive exists — the message can
   * only steer it indirectly, by switching executor onto a different default.
   */
  effort: string | undefined;
  /** "none" when there is no effort override and the executor picks its own. */
  effortSource: Exclude<ExecutionSource, "message" | "default"> | "none";
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
  /** `--effort`, already trimmed and rejected-if-empty by the command. */
  effortOption?: string | undefined;
  configEfforts?: DoWorkEffort | undefined;
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
 * A per-executor default (`doWork.models`, `doWork.effort`) is validated as
 * non-empty when the config file is read, but nothing trims it — so `" high "`
 * would otherwise reach the executor with its padding and be silently ignored
 * as an unknown level. The command-line values arrive already trimmed.
 */
function trimmed(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const cleaned = value.trim();
  return cleaned.length === 0 ? undefined : cleaned;
}

/**
 * Pick a per-executor value that the command line may override.
 *
 * `--model` and `--effort` were chosen by an operator for the executor they
 * expected to run, and neither a Claude model identifier nor a Claude effort
 * level is valid for Codex — the same reason `doWork.models` and
 * `doWork.effort` are keyed per executor. So a directive that *switches*
 * executor drops the flag and falls to the new executor's configured default,
 * or to nothing. A directive naming the executor that was going to run anyway
 * changes nothing, so it must not discard the operator's flag.
 */
function resolvePerExecutor(
  option: string | undefined,
  configured: string | undefined,
  switched: boolean,
): { value: string | undefined; source: "option" | "config" | "none" } {
  if (!switched && option !== undefined) return { value: option, source: "option" };
  const fromConfig = trimmed(configured);
  if (fromConfig !== undefined) return { value: fromConfig, source: "config" };
  return { value: undefined, source: "none" };
}

/**
 * Apply the precedence chain: message directive, then the command line, then
 * `doWork`, then the built-in default.
 *
 * Only the executor and the model can be named in a message. The reasoning
 * effort follows along: it is keyed per executor, so switching executor from a
 * message must re-pick it exactly the way the model is re-picked, otherwise a
 * `tool:codex` on a Claude-defaulted config would hand Codex a Claude level.
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

  const effort = resolvePerExecutor(input.effortOption, input.configEfforts?.[executor], switched);
  const common = {
    ok: true as const,
    executor,
    executorSource,
    effort: effort.value,
    effortSource: effort.source,
  };

  if (directive.model !== undefined) {
    return { ...common, model: directive.model, modelSource: "message" };
  }
  const model = resolvePerExecutor(modelOption, configModels?.[executor], switched);
  return { ...common, model: model.value, modelSource: model.source };
}

/**
 * One-line rendering, shared by the dry-run header and the tick summary so the
 * two cannot describe the same run differently.
 */
export function describeExecution(execution: ResolvedExecution): string {
  const model =
    execution.model === undefined ? " (no model override)" : ` · model ${execution.model}`;
  const effort = execution.effort === undefined ? "" : ` · effort ${execution.effort}`;
  const fromMessage =
    execution.executorSource === "message" || execution.modelSource === "message"
      ? " — from the message"
      : "";
  return `${execution.executor}${model}${effort}${fromMessage}`;
}

/** What the marker comment says when a `tool:` value is not an executor. */
export function describeInvalidTool(invalidTool: string): string {
  return (
    `the newest message asks for \`tool:${invalidTool}\`, which is not an executor automata knows ` +
    `(valid values are ${VALID_TOOLS.map((tool) => `\`${tool}\``).join(" and ")})`
  );
}
