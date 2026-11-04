import { formatMessages, type AnalyzedMessage } from "./conversation.js";
import type { WorkItem } from "./workDetection.js";
import type { ReviewThread } from "./ghWorkService.js";

/**
 * Turn a decided work item into the text handed to the executor.
 *
 * The configured prompt (the "frame") comes first and verbatim, and automata
 * appends only the context it alone can assemble. That ordering is deliberate: a
 * repository can rewrite the instructions completely — including naming a skill —
 * without losing or reordering any of the data.
 */

export interface PromptInput {
  item: WorkItem;
  repo: { owner: string; repo: string };
  agentUser: string;
  /** The configured base branch, used only when the item has no pull request. */
  baseBranch: string;
  /** The resolved configured prompt for this turn kind. */
  frame: string;
}

/**
 * Bytes per token assumed when the budget is checked. Automata has no tokenizer, so the
 * size is an estimate: 4 bytes per token is the usual rule for English text and code, and
 * it errs toward counting more tokens for multi-byte text, which is the safe side.
 */
export const BYTES_PER_TOKEN = 4;

export function estimatePromptTokens(prompt: string): number {
  return Math.ceil(Buffer.byteLength(prompt, "utf8") / BYTES_PER_TOKEN);
}

export type BudgetedPrompt =
  | { ok: true; prompt: string; omittedMessages: number; estimatedTokens: number }
  | { ok: false; detail: string; estimatedTokens: number };

/**
 * The branch this turn must integrate with and must not push to.
 *
 * A pull request's own `baseRefName` wins over the configured `doWork.baseBranch`
 * whenever it is known. For a turn on a pull request automata opened the two
 * agree, but an orphan pull request targets whatever its author chose — a
 * dependency bump goes to the repository default branch, which under the shipped
 * defaults (`baseBranch: develop`) is *not* the configured one. Naming the
 * configured branch there tells the turn to merge `develop` into a branch whose
 * pull request proposes it into `main`.
 */
export function promptBaseBranch(item: WorkItem, configuredBaseBranch: string): string {
  const prBase = item.pr?.baseRefName ?? "";
  return prBase.length > 0 ? prBase : configuredBaseBranch;
}

function formatThreads(threads: ReviewThread[]): string {
  return threads
    .map((thread) => {
      const location = thread.line === null ? `${thread.path}:(file)` : `${thread.path}:${String(thread.line)}`;
      const newest = thread.comments.at(-1);
      const author = newest?.author ?? "unknown";
      const body = newest?.body ?? "";
      // The URL makes an in-thread reply achievable; without it the model can
      // only answer on the conversation, which reads as leaving the thread open.
      const link = thread.url === null ? "" : `\n${thread.url}`;
      return `[${author}] ${location}${link}\n${body}`;
    })
    .join("\n\n");
}

export function composePrompt(input: PromptInput): string {
  return render(input, new Set());
}

/**
 * Compose the prompt and keep it within `maxPromptTokens` (estimated).
 *
 * The oldest conversation messages, from the issue and the pull request together, are
 * dropped first. A message that is new since the last agent message is never dropped, and
 * neither are the frame, the identifiers or the review threads. When that required part
 * alone is too large, no prompt is returned and the detail names the setting to raise.
 */
export function composePromptWithinBudget(input: PromptInput, maxPromptTokens: number): BudgetedPrompt {
  const full = render(input, new Set());
  const fullTokens = estimatePromptTokens(full);
  if (fullTokens <= maxPromptTokens) {
    return { ok: true, prompt: full, omittedMessages: 0, estimatedTokens: fullTokens };
  }

  const droppable = [...input.item.issueAnalysis.messages, ...(input.item.prAnalysis?.messages ?? [])]
    .filter((message) => !message.isNew)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Dropping more usually shortens the prompt, but not always: the first drop on a
  // surface adds that surface's omission marker, which can outweigh a short message. A
  // bisection would be wrong there, so the smallest fitting count is found by a scan.
  let smallest = Number.POSITIVE_INFINITY;
  for (let count = 1; count <= droppable.length; count++) {
    const prompt = render(input, new Set(droppable.slice(0, count)));
    const tokens = estimatePromptTokens(prompt);
    if (tokens <= maxPromptTokens) {
      return { ok: true, prompt, omittedMessages: count, estimatedTokens: tokens };
    }
    smallest = Math.min(smallest, tokens);
  }
  const needed = Math.min(smallest, fullTokens);
  return {
    ok: false,
    estimatedTokens: needed,
    detail:
      `the prompt needs about ${String(needed)} tokens even with older messages omitted, ` +
      `above the budget of ${String(maxPromptTokens)} tokens. Shorten the configured prompt or the newest messages, ` +
      "or raise doWork.maxPromptTokens",
  };
}

/** A conversation section with the dropped messages replaced by one marker line. */
function formatConversation(messages: AnalyzedMessage[], dropped: Set<AnalyzedMessage>): string {
  const omitted = messages.filter((message) => dropped.has(message));
  const kept = formatMessages(messages.filter((message) => !dropped.has(message)));
  if (omitted.length === 0) return kept;
  const first = omitted[0].createdAt;
  const last = omitted.at(-1)?.createdAt ?? first;
  const marker = `[${String(omitted.length)} older message(s) from ${first} to ${last} omitted to fit the prompt budget]`;
  return kept.length > 0 ? `${marker}\n\n${kept}` : marker;
}

function render(input: PromptInput, dropped: Set<AnalyzedMessage>): string {
  const { item, repo, agentUser, baseBranch, frame } = input;

  const lines: string[] = [
    frame.trimEnd(),
    "",
    "--- Context assembled by automata ---",
    `Repository: ${repo.owner}/${repo.repo}`,
    `You are: ${agentUser}`,
    `Turn: ${item.turn}`,
    `Base branch: ${promptBaseBranch(item, baseBranch)}`,
  ];

  // A `pr-orphan` turn has no issue, so every issue line is omitted rather than
  // rendered empty: an "Issue #0" line, or an empty issue conversation, would
  // read to the model as an issue it should go and look at.
  if (item.issue) {
    lines.push(`Issue #${String(item.issue.number)}: ${item.issue.title}`, `Issue URL: ${item.issue.url}`);
  }

  if (item.pr) {
    lines.push(
      `Pull request #${String(item.pr.number)}: ${item.pr.title}`,
      `Pull request URL: ${item.pr.url}`,
      `Branch: ${item.pr.headRefName} (checked out and up to date)`,
    );
  }

  const newMessages = [
    ...item.issueAnalysis.newMessages,
    ...(item.prAnalysis?.newMessages ?? []),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  if (newMessages.length > 0) {
    lines.push("", "New since your last message — this is what you must answer:", "", formatMessages(newMessages));
  }

  if (item.issue) {
    lines.push(
      "",
      "Full conversation on the issue (authorized accounts and you only, oldest first):",
      "",
      formatConversation(item.issueAnalysis.messages, dropped),
    );
  }

  if (item.prAnalysis && item.prAnalysis.messages.length > 0) {
    lines.push(
      "",
      "Conversation on the pull request (authorized accounts and you only, oldest first):",
      "",
      formatConversation(item.prAnalysis.messages, dropped),
    );
  }

  if (item.actionableThreads.length > 0) {
    lines.push("", "Unresolved review threads needing an answer:", "", formatThreads(item.actionableThreads));
  }

  if (item.ambiguousPrs.length > 0) {
    const others = item.ambiguousPrs.map((pr) => `#${String(pr.number)}`).join(", ");
    lines.push(
      "",
      `Note: this issue is also closed by ${others}. You are working on #${String(item.pr?.number ?? 0)}, the most recently updated one.`,
    );
  }

  lines.push(
    "",
    "Only the messages above exist. Anything from other accounts has been withheld",
    "deliberately — do not ask about it.",
  );

  return lines.join("\n");
}
