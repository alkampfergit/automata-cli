import { spawnSync } from "node:child_process";
import type { IssueDiscoveryTechnique } from "./configStore.js";

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  url: string;
}

const GITHUB_ISSUE_COMMENT_URL_RE = /github\.com\/([^/]+\/[^/]+)\/issues\/\d+#issuecomment-(\d+)/;

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

/**
 * Post a comment on a GitHub issue and return the comment URL (if available).
 * The `gh issue comment` command writes the comment URL to stderr on success.
 */
export function postComment(issueNumber: number, body: string): string | undefined {
  const { stderr, status } = run("gh", ["issue", "comment", String(issueNumber), "--body", body]);
  if (status !== 0) {
    throw new Error(stderr.trim() || `Failed to post comment on issue #${issueNumber}.`);
  }
  const match = /https:\/\/github\.com\/[^\s]+#issuecomment-\d+/.exec(stderr);
  return match ? match[0] : undefined;
}

/**
 * Edit an existing GitHub issue comment identified by its URL.
 * Extracts owner/repo and comment ID from the URL.
 */
export function editComment(commentUrl: string, body: string): void {
  const match = GITHUB_ISSUE_COMMENT_URL_RE.exec(commentUrl);
  if (!match) {
    throw new Error(`Cannot parse comment URL: ${commentUrl}`);
  }
  const [, ownerRepo, commentId] = match;
  const { stderr, status } = run("gh", [
    "api", `repos/${ownerRepo}/issues/comments/${commentId}`,
    "-X", "PATCH", "-f", `body=${body}`,
  ]);
  if (status !== 0) {
    throw new Error(stderr.trim() || `Failed to edit comment ${commentId}.`);
  }
}

/**
 * Check if the current branch has an open pull request.
 * Returns the PR number, URL, and body, or null if no PR exists.
 */
export function getCurrentBranchPr(branch?: string): { number: number; url: string; body: string } | null {
  const args = ["pr", "view"];
  if (branch) {
    args.push(branch);
  }
  args.push("--json", "number,url,body");

  const { stdout, stderr, status } = run("gh", args);
  if (status !== 0) {
    if (stderr.includes("no pull requests found") || stderr.includes("Could not resolve")) {
      return null;
    }
    throw new Error(stderr.trim() || "Failed to query PR for current branch.");
  }
  return JSON.parse(stdout) as { number: number; url: string; body: string };
}

/**
 * Append `Closes #N` to the PR body if not already present.
 */
export function addClosesRefToPr(prNumber: number, issueNumber: number): void {
  const { stdout, status: viewStatus } = run("gh", [
    "pr", "view", String(prNumber), "--json", "body", "-q", ".body",
  ]);
  if (viewStatus !== 0) {
    throw new Error(`Failed to read PR #${prNumber} body.`);
  }
  const currentBody = stdout.trimEnd();
  const closesRef = `Closes #${issueNumber}`;
  if (currentBody.includes(closesRef)) {
    return; // already present
  }
  const newBody = currentBody + `\n\n${closesRef}`;
  const { stderr, status } = run("gh", ["pr", "edit", String(prNumber), "--body", newBody]);
  if (status !== 0) {
    throw new Error(stderr.trim() || `Failed to update PR #${prNumber} body.`);
  }
}

/**
 * Add @copilot as a reviewer on the given PR.
 */
export function addCopilotReviewer(prNumber: number): void {
  const { stderr, status } = run("gh", ["pr", "edit", String(prNumber), "--add-reviewer", "@copilot"]);
  if (status !== 0) {
    throw new Error(stderr.trim() || `Failed to add Copilot reviewer to PR #${prNumber}.`);
  }
}
