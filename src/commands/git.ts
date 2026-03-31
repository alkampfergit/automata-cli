import { Command } from "commander";
import {
  getCurrentBranch,
  getPrInfo,
  getPrComments,
  isUpstreamGone,
  hasUncommittedChanges,
  checkoutAndPull,
  deleteLocalBranch,
  fetchPrune,
  type PrCheck,
} from "../git/gitService.js";

const FAIL_CONCLUSIONS = new Set(["FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "CANCELLED"]);
const SKIP_CONCLUSIONS = new Set(["SKIPPED", "NEUTRAL"]);

function checkSymbol(check: PrCheck): string {
  if (check.status !== "COMPLETED") return "●";
  if (check.conclusion === "SUCCESS") return "✓";
  if (check.conclusion !== null && SKIP_CONCLUSIONS.has(check.conclusion)) return "○";
  if (check.conclusion !== null && FAIL_CONCLUSIONS.has(check.conclusion)) return "✗";
  return "●";
}

function formatCheckSummary(checks: PrCheck[]): string {
  const running = checks.some((c) => c.status !== "COMPLETED");
  const failed = checks.filter((c) => c.conclusion !== null && FAIL_CONCLUSIONS.has(c.conclusion));
  const errors =
    failed.length === 0
      ? "none"
      : failed.map((c) => `${c.name}: ${c.description.trim() || c.detailsUrl || "no details available"}`).join("; ");
  return `Checks Running: ${String(running)}\nCheck Errors:   ${errors}\n`;
}

function formatChecks(checks: PrCheck[]): string {
  if (checks.length === 0) return "Checks: none\n";
  const lines: string[] = ["Checks:"];
  for (const check of checks) {
    const sym = checkSymbol(check);
    const pending = check.status !== "COMPLETED" ? " (pending)" : "";
    lines.push(`  ${sym} ${check.name}${pending}`);
    if (check.conclusion !== null && FAIL_CONCLUSIONS.has(check.conclusion)) {
      const desc = check.description.trim();
      const url = check.detailsUrl.trim();
      if (desc) lines.push(`    Details: ${desc}`);
      if (url) lines.push(`    URL:     ${url}`);
      if (!desc && !url) lines.push(`    Details: (no details available)`);
    }
  }
  return lines.join("\n") + "\n";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatFailedChecks(failed: PrCheck[]): string {
  const lines: string[] = [];
  for (const check of failed) {
    lines.push(`  ✗ ${check.name}`);
    const desc = check.description.trim();
    const url = check.detailsUrl.trim();
    if (desc) lines.push(`    Details: ${desc}`);
    if (url) lines.push(`    URL:     ${url}`);
    if (!desc && !url) lines.push(`    Details: (no details available)`);
  }
  return lines.join("\n") + "\n";
}

const POLL_INTERVAL_MS = 10_000;

const getPrInfoCmd = new Command("get-pr-info")
  .description("Show pull request info for the current branch")
  .option("--json", "Output as JSON")
  .option("--wait-finish-checks", "Poll until all checks complete, then report pass/fail (exit 1 on failure)")
  .addHelpText(
    "after",
    `
Check status symbols:
  ✓  Passed        (conclusion: SUCCESS)
  ✗  Failed        (conclusion: FAILURE / TIMED_OUT / ACTION_REQUIRED / CANCELLED)
  ●  Pending       (status: QUEUED or IN_PROGRESS)
  ○  Skipped       (conclusion: SKIPPED or NEUTRAL)

Failure details are printed beneath each ✗ check.
See docs/git.md for full output reference.`,
  )
  .action(async (options: { json?: boolean; waitFinishChecks?: boolean }) => {
    let branch: string;
    try {
      branch = getCurrentBranch();
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(1);
    }

    if (options.waitFinishChecks) {
      let pr;
      while (true) {
        try {
          pr = getPrInfo(branch);
        } catch (err) {
          process.stderr.write(`Error: ${(err as Error).message}\n`);
          process.exit(1);
        }
        if (pr === null) {
          process.stderr.write(`Error: No pull request found for branch: ${branch}\n`);
          process.exit(1);
        }
        const running = pr.checks.filter((c) => c.status !== "COMPLETED");
        if (running.length === 0) break;
        process.stdout.write(`Waiting for ${running.length} check(s) to complete...\n`);
        await sleep(POLL_INTERVAL_MS);
      }

      const failed = pr.checks.filter((c) => c.conclusion !== null && FAIL_CONCLUSIONS.has(c.conclusion));
      if (failed.length === 0) {
        if (options.json) {
          process.stdout.write(JSON.stringify({ result: "passed" }, null, 2) + "\n");
        } else {
          process.stdout.write(`All checks passed. ✓\n`);
        }
        process.exit(0);
      } else {
        if (options.json) {
          process.stdout.write(JSON.stringify({ result: "failed", failed }, null, 2) + "\n");
        } else {
          process.stdout.write(`${failed.length} check(s) failed:\n`);
          process.stdout.write(formatFailedChecks(failed));
        }
        process.exit(1);
      }
      return;
    }

    let pr;
    try {
      pr = getPrInfo(branch);
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(1);
    }

    if (pr === null) {
      process.stdout.write(`No pull request found for branch: ${branch}\n`);
      process.exit(0);
    }

    if (options.json) {
      process.stdout.write(JSON.stringify(pr, null, 2) + "\n");
    } else {
      process.stdout.write(`PR:    #${pr.number}\nTitle: ${pr.title}\nState: ${pr.state}\nURL:   ${pr.url}\n`);
      process.stdout.write(formatCheckSummary(pr.checks));
      process.stdout.write(formatChecks(pr.checks));
    }
  });

// Strip ANSI/CSI escape sequences and non-printable control characters from
// untrusted text before writing to the terminal.
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_RE = new RegExp("\x1b(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])", "g");
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = new RegExp("[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "g");

function sanitizeText(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, "").replace(CONTROL_CHARS_RE, "");
}

const getPrCommentsCmd = new Command("get-pr-comments")
  .description("List open (unresolved) review comments on the pull request for the current branch (GitHub only)")
  .option("--json", "Output as JSON array")
  .addHelpText(
    "after",
    `
Only GitHub (remoteType: gh) is supported. Azure DevOps is not supported.
See docs/azdo-gap.md for details.`,
  )
  .action((options: { json?: boolean }) => {
    let branch: string;
    try {
      branch = getCurrentBranch();
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(1);
    }

    let comments;
    try {
      comments = getPrComments(branch);
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(1);
    }

    if (comments === "unsupported") {
      process.stderr.write(
        `Error: get-pr-comments is not supported for Azure DevOps. See docs/azdo-gap.md for details.\n`,
      );
      process.exit(1);
    }

    if (comments === null) {
      process.stderr.write(`Error: No pull request found for branch: ${branch}\n`);
      process.exit(1);
    }

    if (options.json) {
      process.stdout.write(JSON.stringify(comments, null, 2) + "\n");
      return;
    }

    if (comments.length === 0) {
      process.stdout.write(`No open comments.\n`);
      return;
    }

    const lines: string[] = [];
    for (const c of comments) {
      const loc = c.line !== null ? `${c.path}:${String(c.line)}` : `${c.path}:(file)`;
      const safeBody = sanitizeText(c.body);
      const safeAuthor = sanitizeText(c.author);
      lines.push(`[${safeAuthor}] on ${loc}\n${safeBody}`);
    }
    process.stdout.write(lines.join("\n\n") + "\n");
  });

const finishFeatureCmd = new Command("finish-feature")
  .description("Clean up a merged feature branch: checkout develop, pull, and delete local branch")
  .action(() => {
    let branch: string;
    try {
      branch = getCurrentBranch();
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(1);
    }

    if (branch === "develop") {
      process.stderr.write("Error: finish-feature cannot be run from the develop branch.\n");
      process.exit(1);
    }

    if (hasUncommittedChanges()) {
      process.stderr.write(
        "Error: You have uncommitted changes. Commit or stash them before running finish-feature.\n",
      );
      process.exit(1);
    }

    let pr;
    try {
      pr = getPrInfo(branch);
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(1);
    }

    if (pr === null) {
      process.stderr.write(`Error: No pull request found for branch: ${branch}\n`);
      process.exit(1);
    }

    if (pr.state === "OPEN") {
      process.stderr.write(`Error: Pull request #${pr.number} is still open. Merge it before finishing the feature.\n`);
      process.exit(1);
    }

    if (pr.state === "CLOSED") {
      process.stderr.write(
        `Error: Pull request #${pr.number} was closed without merging. finish-feature only proceeds for merged PRs.\n`,
      );
      process.exit(1);
    }

    if (!isUpstreamGone(branch)) {
      process.stderr.write(
        `Error: Remote tracking branch 'origin/${branch}' still exists. Push or delete it remotely before finishing.\n`,
      );
      process.exit(1);
    }

    try {
      process.stdout.write(`Fetching and pruning remote refs...\n`);
      fetchPrune();
      process.stdout.write(`Checking out develop and pulling latest...\n`);
      checkoutAndPull("develop");
      process.stdout.write(`Deleting local branch: ${branch}\n`);
      deleteLocalBranch(branch);
      process.stdout.write(`Done. Branch '${branch}' has been removed.\n`);
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(1);
    }
  });

export const gitCommand = new Command("git")
  .description("Git workflow commands (requires gh CLI)")
  .addCommand(getPrInfoCmd)
  .addCommand(getPrCommentsCmd)
  .addCommand(finishFeatureCmd);
