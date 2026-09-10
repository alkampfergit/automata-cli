import { formatMessages } from "./conversation.js";
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
      formatMessages(item.issueAnalysis.messages),
    );
  }

  if (item.prAnalysis && item.prAnalysis.messages.length > 0) {
    lines.push(
      "",
      "Conversation on the pull request (authorized accounts and you only, oldest first):",
      "",
      formatMessages(item.prAnalysis.messages),
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
