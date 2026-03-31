import { spawnSync } from "node:child_process";
import type { PrInfo } from "../git/gitService.js";

interface AzdoPullRequest {
  id: number;
  title: string;
  status: string;
  url: string;
}

interface AzdoPrStatusOutput {
  pullRequests: AzdoPullRequest[];
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

export function getPrInfo(): PrInfo | null {
  const { stdout, stderr, status } = run("azdo", ["pr", "status", "--json"]);

  if (status !== 0) {
    throw new Error(stderr.trim() || "Failed to query Azure DevOps PR status. Is `azdo` installed and authenticated?");
  }

  const parsed = JSON.parse(stdout) as AzdoPrStatusOutput;

  if (parsed.pullRequests.length === 0) {
    return null;
  }

  const pr = parsed.pullRequests[0];

  return {
    number: pr.id,
    title: pr.title,
    state: mapStatus(pr.status),
    url: pr.url,
    checks: [],
  };
}
