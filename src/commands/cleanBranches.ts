import { createInterface } from "node:readline";
import { Command } from "commander";
import { readRawConfig } from "../config/configStore.js";
import {
  countUnpushedCommits,
  deleteRemoteBranch,
  fetchPruneOrigin,
  forceDeleteLocalBranch,
  getCurrentBranch,
  listLocalBranches,
  listRemoteBranches,
  resolveTrunkBranch,
} from "../git/gitService.js";
import { listSameRepoPullRequests } from "../github/ghWorkService.js";
import { azdoUnsupportedMessage, isAzdo } from "../remote/backend.js";
import {
  executeDeletions,
  formatEntry,
  planLocalCleanup,
  planRemoteCleanup,
  protectedBranches,
  type CleanupEntry,
  type PullRequestState,
} from "../git/branchCleanup.js";

export interface CleanBranchesOptions {
  dryRun?: boolean;
  yes?: boolean;
  localOnly?: boolean;
  remoteOnly?: boolean;
}

function fail(message: string): number {
  process.stderr.write(`Error: ${message}\n`);
  return 1;
}

function lookupPullRequests(branch: string): PullRequestState[] | null {
  try {
    return listSameRepoPullRequests(branch);
  } catch {
    return null;
  }
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

function printPlan(entries: CleanupEntry[], dryRun: boolean): void {
  process.stdout.write("Plan:\n");
  for (const entry of entries) process.stdout.write(`${formatEntry(entry, dryRun)}\n`);
}

/** The exit code to stop with, or null when the user agreed to go on. */
async function askToProceed(summary: string): Promise<number | null> {
  if (!process.stdin.isTTY) {
    return fail("Confirmation needs a terminal. Nothing was deleted. Use --yes to skip the question.");
  }
  if (await confirm(`${summary} Delete them? [y/N] `)) return null;
  process.stdout.write("Aborted. Nothing was deleted.\n");
  return 0;
}

type PlanResult = { ok: true; entries: CleanupEntry[] } | { ok: false; message: string };

/** Fetches, reads the branches and builds the plan. Reads only; nothing is deleted here. */
function buildPlan(options: CleanBranchesOptions): PlanResult {
  const fetched = fetchPruneOrigin();
  if (!fetched.ok) return { ok: false, message: `Failed to fetch --prune origin: ${fetched.stderr}` };
  const remotes = listRemoteBranches();
  if (remotes === null) return { ok: false, message: "Could not list the branches of origin. Nothing was deleted." };

  let current: string;
  try {
    current = getCurrentBranch();
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  const trunk = resolveTrunkBranch();
  const protectedSet = protectedBranches(current, trunk.ok ? trunk.branch : null);

  const entries: CleanupEntry[] = [];
  if (!options.remoteOnly) {
    entries.push(...planLocalCleanup(listLocalBranches(), remotes, protectedSet, current, countUnpushedCommits));
  }
  if (!options.localOnly) {
    entries.push(...planRemoteCleanup(remotes, protectedSet, current, lookupPullRequests));
  }
  return { ok: true, entries };
}

/** Runs the planned deletions and reports each one. Returns how many failed. */
function applyDeletions(planned: CleanupEntry[]): number {
  const outcomes = executeDeletions(planned, { local: forceDeleteLocalBranch, remote: deleteRemoteBranch });
  for (const { entry, ok, message } of outcomes) {
    if (ok) process.stdout.write(`Deleted ${entry.scope} branch ${entry.branch}\n`);
    else process.stderr.write(`Failed to delete ${entry.scope} branch ${entry.branch}: ${message}\n`);
  }
  const failed = outcomes.filter((outcome) => !outcome.ok).length;
  process.stdout.write(`Done. ${String(outcomes.length - failed)} deleted, ${String(failed)} failed.\n`);
  return failed;
}

/** `automata git clean-branches`: the exit code, after the plan has been made, confirmed and run. */
export async function runCleanBranches(options: CleanBranchesOptions): Promise<number> {
  if (options.localOnly && options.remoteOnly) {
    return fail("--local-only and --remote-only cannot be used together.");
  }
  if (!options.localOnly && isAzdo(readRawConfig())) {
    return fail(azdoUnsupportedMessage("clean-branches", "The remote phase needs GitHub; use --local-only."));
  }

  const plan = buildPlan(options);
  if (!plan.ok) return fail(plan.message);

  const dryRun = options.dryRun ?? false;
  printPlan(plan.entries, dryRun);
  const lookupFailures = plan.entries.filter((entry) => entry.failed === true).length;
  const planned = plan.entries.filter((entry) => entry.action === "delete");
  const summary = `${String(planned.length)} branch(es) to delete.`;

  if (dryRun || planned.length === 0) {
    process.stdout.write(dryRun ? `Dry-run: ${summary} Nothing was changed.\n` : "Nothing to delete.\n");
    return lookupFailures > 0 ? 1 : 0;
  }

  if (!options.yes) {
    const stop = await askToProceed(summary);
    if (stop !== null) return stop;
  }

  return applyDeletions(planned) + lookupFailures > 0 ? 1 : 0;
}

export const cleanBranchesCmd = new Command("clean-branches")
  .description("Delete local branches with no origin branch and origin branches whose pull requests are closed")
  .option("--dry-run", "Print the plan and change nothing")
  .option("--yes", "Do not ask for confirmation")
  .option("--local-only", "Run the local phase only")
  .option("--remote-only", "Run the remote phase only")
  .action(async (options: CleanBranchesOptions) => {
    process.exitCode = await runCleanBranches(options);
  });
