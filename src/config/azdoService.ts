import { spawnSync } from "node:child_process";
import type { PrCheck, PrInfo } from "../git/gitService.js";

interface AzdoPullRequest {
  id: number;
  title: string;
  status: string;
  url: string;
}

interface AzdoCheck {
  state: string;
  name: string;
  description?: string | null;
  targetUrl?: string | null;
}

interface AzdoPullRequestWithChecks extends AzdoPullRequest {
  checks?: AzdoCheck[];
  checksError?: string | null;
}

interface AzdoPrStatusOutput {
  pullRequests: AzdoPullRequestWithChecks[];
}

interface AzdoRun {
  id: number;
  name?: string | null;
  state: string;
  result: string | null;
}

function run(cmd: string, args: string[]): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new Error("`azdo` CLI is not installed or not on PATH.");
    }
    throw new Error(err.message);
  }
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? 1,
  };
}

function mapStatus(azdoStatus: string): string {
  switch (azdoStatus) {
    case "active":
      return "OPEN";
    case "completed":
      return "MERGED";
    case "abandoned":
      return "CLOSED";
    default:
      return azdoStatus.toUpperCase();
  }
}

/** Maps an azdo check state onto the GitHub status/conclusion vocabulary that the renderer understands. */
export function mapCheckState(state: string): Pick<PrCheck, "status" | "conclusion"> {
  switch (state) {
    case "succeeded":
      return { status: "COMPLETED", conclusion: "SUCCESS" };
    case "failed":
    case "rejected":
    case "error":
      return { status: "COMPLETED", conclusion: "FAILURE" };
    case "notApplicable":
    case "notSet":
      return { status: "COMPLETED", conclusion: "SKIPPED" };
    case "queued":
      return { status: "QUEUED", conclusion: null };
    case "running":
      return { status: "IN_PROGRESS", conclusion: null };
    default:
      return { status: "PENDING", conclusion: null };
  }
}

function mapRunState(run: AzdoRun): string {
  if (run.state !== "completed") return "pending";
  switch (run.result) {
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "canceled":
      return "error";
    default:
      return "pending";
  }
}

function toPrCheck(check: AzdoCheck): PrCheck {
  return {
    name: check.name,
    ...mapCheckState(check.state),
    description: check.description ?? "",
    detailsUrl: check.targetUrl ?? "",
  };
}

function runJson<T>(args: string[], failure: string): T {
  const { stdout, stderr, status } = run("azdo", [...args, "--json", "--no-update-check"]);
  if (status !== 0) {
    throw new Error(stderr.trim() || failure);
  }
  return JSON.parse(stdout) as T;
}

function toPrInfo(pr: AzdoPullRequest, checks: PrCheck[]): PrInfo {
  return { number: pr.id, title: pr.title, state: mapStatus(pr.status), url: pr.url, checks };
}

function getBranchPrInfo(branch: string): PrInfo | null {
  const listed = runJson<AzdoPrStatusOutput>(
    ["pr", "list", "--branch", branch, "--status", "all"],
    "Failed to list Azure DevOps pull requests. Is `azdo` installed and authenticated?",
  );
  const pr = listed.pullRequests[0];
  if (pr === undefined) return null;

  const runs = runJson<AzdoRun[]>(
    ["pipeline", "get-runs", "--pr", String(pr.id)],
    "Failed to list Azure DevOps pipeline runs for the pull request.",
  );
  const checks = runs.map((r) =>
    toPrCheck({ state: mapRunState(r), name: `Build ${r.name ?? String(r.id)}` }),
  );
  return toPrInfo(pr, checks);
}

/**
 * Pull request of the checked-out branch (`branch` omitted) or of another branch. Only `azdo pr status` reports
 * policy and status checks and it has no branch option, so another branch reports its pipeline runs instead.
 */
export function getPrInfo(branch?: string): PrInfo | null {
  if (branch !== undefined) return getBranchPrInfo(branch);

  const parsed = runJson<AzdoPrStatusOutput>(
    ["pr", "status"],
    "Failed to query Azure DevOps PR status. Is `azdo` installed and authenticated?",
  );
  const pr = parsed.pullRequests[0];
  if (pr === undefined) return null;
  if (pr.checksError) {
    throw new Error(`Azure DevOps could not retrieve the checks of PR #${pr.id}: ${pr.checksError}`);
  }
  return toPrInfo(pr, (pr.checks ?? []).map(toPrCheck));
}
