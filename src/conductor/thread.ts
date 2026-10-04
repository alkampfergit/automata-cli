import { analyzeSurface, formatMessages, type Participants, type RawMessage } from "../github/conversation.js";
import type { CiCheck, IssueSurface, PrSurface, ReviewThread } from "../github/ghWorkService.js";

/**
 * Pure assembly of the thread the conductor hands to the model.
 *
 * As in `workPrompt.ts`, the configured prompt (the "frame") comes first and
 * verbatim and automata appends only the context it alone can assemble, so a
 * repository can rewrite the instructions without losing any data. Messages
 * from accounts that are neither allowed nor the agent are withheld.
 */

export interface ThreadPr {
  surface: PrSurface;
  checks: CiCheck[];
}

/** What the conductor reads: an issue with its linked pull requests, or one pull request. */
export type ConductorThread =
  | { kind: "issue"; issue: IssueSurface; prs: ThreadPr[] }
  | { kind: "pr"; prs: [ThreadPr] };

export interface ConductorPromptInput {
  thread: ConductorThread;
  repo: { owner: string; repo: string };
  participants: Participants;
  /** The resolved `conductor.prompts.issue` or `conductor.prompts.pr`. */
  frame: string;
}

/** Which configured prompt frames a thread. */
export function promptKeyFor(thread: ConductorThread): "issue" | "pr" {
  return thread.kind;
}

function visible(messages: RawMessage[], participants: Participants): RawMessage[] {
  // `isNew` is `do-work`'s boundary; the conductor reads the whole thread, so it is dropped.
  return analyzeSurface(messages, participants).messages.map((message) => ({
    kind: message.kind,
    author: message.author,
    body: message.body,
    createdAt: message.createdAt,
  }));
}

function renderMessages(messages: RawMessage[], participants: Participants): string {
  const kept = visible(messages, participants);
  return kept.length === 0 ? "(no messages)" : formatMessages(kept.map((m) => ({ ...m, isNew: false })));
}

function renderThread(thread: ReviewThread, participants: Participants): string | null {
  const comments = visible(thread.comments, participants);
  if (comments.length === 0) return null;
  const location = thread.line === null ? `${thread.path}:(file)` : `${thread.path}:${String(thread.line)}`;
  const link = thread.url === null ? "" : `\n${thread.url}`;
  return `${location}${link}\n${formatMessages(comments.map((m) => ({ ...m, isNew: false })))}`;
}

/** One line per check; a check that has not finished says so instead of showing a conclusion. */
export function renderChecks(checks: CiCheck[]): string {
  if (checks.length === 0) return "No checks reported.";
  return checks
    .map((check) => `- ${check.name}: ${check.status === "COMPLETED" ? (check.conclusion ?? "COMPLETED") : check.status}`)
    .join("\n");
}

/** The pull request description, only when an allowed account wrote it and it says something. */
function descriptionLines(description: ThreadPr["surface"]["description"], participants: Participants): string[] {
  if (description === undefined || description.body.trim().length === 0) return [""];
  const [kept] = visible([{ kind: "issue-body", author: description.author, body: description.body, createdAt: "" }], participants);
  if (kept === undefined) return [""];
  return ["", `Pull request description (by ${kept.author}):`, "", kept.body, ""];
}

function prSection(pr: ThreadPr, participants: Participants): string[] {
  const { surface, checks } = pr;
  const number = String(surface.pr.number);
  const lines = [
    "",
    `Pull request #${number}: ${surface.pr.title}`,
    `Pull request URL: ${surface.pr.url}`,
    `State: ${surface.pr.state}${surface.pr.isDraft ? " (draft)" : ""} · Branch: ${surface.pr.headRefName} into ${surface.pr.baseRefName}`,
    ...descriptionLines(surface.description, participants),
    `Conversation on pull request #${number} (authorized accounts and you only, oldest first):`,
    "",
    renderMessages(surface.messages, participants),
  ];
  const threads = surface.threads
    .filter((thread) => !thread.isResolved)
    .map((thread) => renderThread(thread, participants))
    .filter((text): text is string => text !== null);
  if (threads.length > 0) {
    lines.push("", `Unresolved review threads on pull request #${number}:`, "", threads.join("\n\n"));
  }
  lines.push("", `CI status of pull request #${number}:`, "", renderChecks(checks));
  return lines;
}

export function composeConductorPrompt(input: ConductorPromptInput): string {
  const { thread, repo, participants, frame } = input;
  const lines = [
    frame,
    "",
    "--- Thread assembled by automata ---",
    `Repository: ${repo.owner}/${repo.repo}`,
    `The agent is: ${participants.agentUser}`,
  ];

  if (thread.kind === "issue") {
    lines.push(
      "",
      `Issue #${String(thread.issue.issue.number)}: ${thread.issue.issue.title}`,
      `Issue URL: ${thread.issue.issue.url}`,
      `State: ${thread.issue.state}`,
      "",
      "Conversation on the issue (authorized accounts and you only, oldest first):",
      "",
      renderMessages(thread.issue.messages, participants),
    );
  }
  for (const pr of thread.prs) lines.push(...prSection(pr, participants));

  lines.push(
    "",
    "Only the messages above exist. Anything from other accounts has been withheld",
    "deliberately — do not ask about it.",
  );
  return lines.join("\n");
}
