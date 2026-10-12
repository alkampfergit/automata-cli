import type { PrSurface, ReviewThread } from "../github/ghWorkService.js";
import type { RawMessage } from "../github/conversation.js";

/**
 * Open review threads that Copilot started. The conductor tells the agent to fix
 * them and to resolve each thread; the rules here are pure.
 */

/** `Copilot`, `copilot-pull-request-reviewer` and the like. */
export function isCopilotAuthor(author: string): boolean {
  return author.toLowerCase().includes("copilot");
}

/** The unresolved threads whose first comment is Copilot's. */
export function openCopilotThreads(surface: PrSurface): ReviewThread[] {
  return surface.threads.filter(
    (thread) => !thread.isResolved && thread.comments.length > 0 && isCopilotAuthor(thread.comments[0].author),
  );
}

/** The newest Copilot comment in these threads, or null when there is none. */
export function newestCopilotAt(threads: ReviewThread[]): string | null {
  let newest: string | null = null;
  for (const comment of threads.flatMap((thread) => thread.comments)) {
    if (isCopilotAuthor(comment.author) && (newest === null || comment.createdAt > newest)) newest = comment.createdAt;
  }
  return newest;
}

/** The text that asks the model to pass the Copilot comments on to the agent. */
export function renderCopilotBlock(number: number, threads: ReviewThread[], agentUser: string): string {
  const items = threads.map((thread) => {
    const location = thread.line === null ? `${thread.path}:(file)` : `${thread.path}:${String(thread.line)}`;
    const first: RawMessage = thread.comments[0];
    const link = thread.url === null ? "" : ` (${thread.url})`;
    return `- ${location}${link}\n  ${first.author}: ${first.body.trim().split("\n").join("\n  ")}`;
  });
  return [
    `Open Copilot review comments on pull request #${String(number)}:`,
    "",
    items.join("\n"),
    "",
    `Add to your reply an instruction to ${agentUser}: fix each comment above, and then resolve its review thread. ` +
      "Do not resolve a thread yourself.",
  ].join("\n");
}
