import { spawnSync } from "node:child_process";
import { readConfig } from "../config/configStore.js";
import * as azdoService from "../config/azdoService.js";

export interface PrCheck {
  name: string;
  status: string;
  conclusion: string | null;
  description: string;
  detailsUrl: string;
}

export interface PrInfo {
  number: number;
  title: string;
  state: string;
  url: string;
  checks: PrCheck[];
}

function run(cmd: string, args: string[]): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? 1,
  };
}

export function getCurrentBranch(): string {
  const { stdout, status } = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (status !== 0) {
    throw new Error("Failed to determine current branch. Are you inside a git repository?");
  }
  return stdout.trim();
}

interface RawCheckRollup {
  name: string;
  status: string;
  conclusion: string | null;
  description: string;
  detailsUrl: string;
}

interface RawPrView {
  number: number;
  title: string;
  state: string;
  url: string;
  statusCheckRollup: RawCheckRollup[] | null;
}

function getPrInfoGh(branch: string): PrInfo | null {
  const { stdout, stderr, status } = run("gh", [
    "pr",
    "view",
    branch,
    "--json",
    "number,title,state,url,statusCheckRollup",
  ]);
  if (status !== 0) {
    if (stderr.includes("no pull requests found") || stderr.includes("Could not resolve")) {
      return null;
    }
    throw new Error(stderr.trim() || "Failed to query GitHub. Is `gh` installed and authenticated?");
  }
  const raw = JSON.parse(stdout) as RawPrView;
  const checks: PrCheck[] = (raw.statusCheckRollup ?? []).map((c) => ({
    name: c.name,
    status: c.status,
    conclusion: c.conclusion,
    description: c.description ?? "",
    detailsUrl: c.detailsUrl ?? "",
  }));
  return { number: raw.number, title: raw.title, state: raw.state, url: raw.url, checks };
}

export function getPrInfo(branch: string): PrInfo | null {
  const config = readConfig();
  if (config.remoteType === "azdo") {
    return azdoService.getPrInfo();
  }
  return getPrInfoGh(branch);
}

export function isUpstreamGone(branch: string): boolean {
  const { status } = run("git", ["ls-remote", "--exit-code", "--heads", "origin", branch]);
  // exit code 2 means the ref was not found (upstream is gone)
  return status !== 0;
}

export function hasUncommittedChanges(): boolean {
  const { stdout } = run("git", ["status", "--porcelain"]);
  return stdout.trim().length > 0;
}

export function checkoutAndPull(targetBranch: string): void {
  const checkout = run("git", ["checkout", targetBranch]);
  if (checkout.status !== 0) {
    throw new Error(`Failed to checkout ${targetBranch}: ${checkout.stderr.trim()}`);
  }
  const pull = run("git", ["pull"]);
  if (pull.status !== 0) {
    throw new Error(`Failed to pull ${targetBranch}: ${pull.stderr.trim()}`);
  }
}

export function fetchPrune(): void {
  const result = run("git", ["fetch", "--prune"]);
  if (result.status !== 0) {
    throw new Error(`Failed to fetch --prune: ${result.stderr.trim()}`);
  }
}

export function deleteLocalBranch(branch: string): void {
  const result = run("git", ["branch", "-D", branch]);
  if (result.status !== 0) {
    throw new Error(`Failed to delete branch ${branch}: ${result.stderr.trim()}`);
  }
}
