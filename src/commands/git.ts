import { Command } from "commander";
import {
  getCurrentBranch,
  getPrInfo,
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
      : failed.map((c) => `${c.name}: ${c.description.trim() || "no details available"}`).join("; ");
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
      const detail = check.description.trim() || "(no details available)";
      lines.push(`    Details: ${detail}`);
    }
  }
  return lines.join("\n") + "\n";
}

const getPrInfoCmd = new Command("get-pr-info")
  .description("Show pull request info for the current branch")
  .option("--json", "Output as JSON")
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
  .action((options: { json?: boolean }) => {
    let branch: string;
    try {
      branch = getCurrentBranch();
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
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
  .addCommand(finishFeatureCmd);
