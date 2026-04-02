import { spawnSync } from "node:child_process";
import type { IssueDiscoveryTechnique } from "./configStore.js";

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  url: string;
}

function run(cmd: string, args: string[]): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new Error("`gh` CLI is not installed or not on PATH.");
    }
    throw new Error(err.message);
  }
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? 1,
  };
}

export function listIssues(technique: IssueDiscoveryTechnique, value: string, limit = 10): GitHubIssue[] {
  const baseArgs = [
    "issue",
    "list",
    "--state",
    "open",
    "--limit",
    String(limit),
    "--json",
    "number,title,body,url",
  ];

  let filterArgs: string[];
  switch (technique) {
    case "label":
      filterArgs = ["--label", value];
      break;
    case "assignee":
      filterArgs = ["--assignee", value];
      break;
    case "title-contains":
      filterArgs = ["--search", `${value} in:title`];
      break;
  }

  const { stdout, stderr, status } = run("gh", [...baseArgs, ...filterArgs]);

  if (status !== 0) {
    throw new Error(stderr.trim() || "Failed to query GitHub issues. Is `gh` installed and authenticated?");
  }

  return JSON.parse(stdout) as GitHubIssue[];
}

export function postComment(issueNumber: number, body: string): void {
  const { stderr, status } = run("gh", ["issue", "comment", String(issueNumber), "--body", body]);
  if (status !== 0) {
    throw new Error(stderr.trim() || `Failed to post comment on issue #${issueNumber}.`);
  }
}
