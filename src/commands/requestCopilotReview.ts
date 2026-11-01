import { Command } from "commander";
import { readRawConfig } from "../config/configStore.js";
import { addCopilotReviewer } from "../config/githubService.js";
import { getPrNumberAndState } from "../github/ghWorkService.js";
import { azdoUnsupportedMessage, isAzdo } from "../remote/backend.js";
import { parseWatchId } from "../conductor/watchList.js";

function fail(message: string): number {
  process.stderr.write(`Error: ${message}\n`);
  return 1;
}

/** `automata git request-copilot-review [<pr>]`: the same request the conductor makes for a review round. */
export function runRequestCopilotReview(rawPr?: string): number {
  if (isAzdo(readRawConfig())) {
    return fail(azdoUnsupportedMessage("request-copilot-review", "Copilot review needs GitHub."));
  }
  let requested: number | undefined;
  if (rawPr !== undefined) {
    const parsed = parseWatchId(rawPr);
    if (parsed === null) return fail(`"${rawPr}" is not a pull request number.`);
    requested = parsed;
  }
  try {
    const pr = getPrNumberAndState(requested);
    if (pr.state !== "OPEN") return fail(`pull request #${String(pr.number)} is ${pr.state.toLowerCase()}; nothing to review.`);
    addCopilotReviewer(pr.number);
    process.stdout.write(`Requested a Copilot review of pull request #${String(pr.number)}.\n`);
    return 0;
  } catch (err) {
    return fail((err as Error).message);
  }
}

/** `automata git request-copilot-review`; `index.ts` adds it to the `git` group. */
export const requestCopilotReviewCmd = new Command("request-copilot-review")
  .description("Ask Copilot to review a pull request (default: the pull request of the current branch)")
  .argument("[pr]", "Pull request number")
  .action((pr: string | undefined) => {
    const code = runRequestCopilotReview(pr);
    if (code !== 0) process.exit(code);
  });
