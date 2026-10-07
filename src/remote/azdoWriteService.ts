import { spawnSync } from "node:child_process";
import { AZDO_NO_UPDATE_CHECK } from "./azdoPrerequisites.js";
import type { CurrentBranchPr, RemoteWriteService } from "./writeService.js";

/** azdo-cli rejects a longer pull request description client-side (`MAX_PR_DESCRIPTION_CHARS`). */
export const AZDO_MAX_PR_DESCRIPTION_CHARS = 4000;

/**
 * `azdo comments add` takes the text as one argv element and has no file or stdin form in 0.20.0. Spawned without
 * a shell, quoting is not an issue; the command-line length is, and Windows caps it near 32k characters.
 */
export const AZDO_MAX_ARGV_COMMENT_CHARS = 30000;

interface AzdoPr {
  id: number;
  url: string;
  description: string | null;
}

function runAzdo(args: string[], failure: string, input?: string): string {
  // Resolving `azdo` through PATH is the point of the "on PATH" prerequisite.
  const result = spawnSync("azdo", [...args, AZDO_NO_UPDATE_CHECK], { encoding: "utf8", input }); // NOSONAR
  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
    throw new Error(err.code === "ENOENT" ? "`azdo` CLI is not installed or not on PATH." : err.message);
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error((result.stderr ?? "").trim() || failure);
  }
  return result.stdout ?? "";
}

function prArgs(prNumber: number): string[] {
  return ["--pr-number", String(prNumber)];
}

function getCurrentBranchPr(branch?: string): CurrentBranchPr | null {
  const args = branch === undefined ? ["pr", "status"] : ["pr", "list", "--branch", branch, "--status", "active"];
  const stdout = runAzdo([...args, "--json"], "Failed to query the Azure DevOps pull request of the branch.");
  const pr = (JSON.parse(stdout) as { pullRequests: AzdoPr[] }).pullRequests[0];
  if (pr === undefined) return null;
  // Azure DevOps pull requests have no assignees.
  return { number: pr.id, url: pr.url, body: pr.description ?? "", assignees: [] };
}

function updatePrDescription(prNumber: number, body: string): void {
  if (body.length > AZDO_MAX_PR_DESCRIPTION_CHARS) {
    throw new Error(
      `The description of PR #${String(prNumber)} is ${String(body.length)} characters, over the Azure DevOps limit of ${String(AZDO_MAX_PR_DESCRIPTION_CHARS)}.`,
    );
  }
  runAzdo(
    ["pr", "update", ...prArgs(prNumber), "--description-file", "-"],
    `Failed to update the description of PR #${String(prNumber)}.`,
    body,
  );
}

/** azdo-cli has no "show PR <id>": try the current branch's PR, then the active PRs of the repository. */
function findPr(prNumber: number): AzdoPr {
  for (const args of [["pr", "status"], ["pr", "list", "--status", "active", "--top", "200"]]) {
    const stdout = runAzdo([...args, "--json"], `Failed to read PR #${String(prNumber)}.`);
    const pr = (JSON.parse(stdout) as { pullRequests: AzdoPr[] }).pullRequests.find((p) => p.id === prNumber);
    if (pr !== undefined) return pr;
  }
  throw new Error(`PR #${String(prNumber)} was not found among the active Azure DevOps pull requests.`);
}

function linkPrToIssue(prNumber: number, issueNumber: number): void {
  const ref = new RegExp(String.raw`(?<![\w#])AB#${String(issueNumber)}\b`);
  const pr = findPr(prNumber);
  const current = (pr.description ?? "").trimEnd();
  if (!ref.test(current)) {
    updatePrDescription(prNumber, current === "" ? `AB#${String(issueNumber)}` : `${current}\n\nAB#${String(issueNumber)}`);
  }
  try {
    runAzdo(
      ["pr", "work-items", "link", String(issueNumber), ...prArgs(prNumber)],
      `Failed to link work item #${String(issueNumber)} to PR #${String(prNumber)}.`,
    );
  } catch (error) {
    // Linking twice is the same end state.
    if (!/already\s+(linked|associated)|link\s+already\s+exists/i.test(error instanceof Error ? error.message : "")) throw error;
  }
}

export const azdoWriteService: RemoteWriteService = {
  getCurrentBranchPr,
  updatePrDescription,
  linkPrToIssue,

  requestReview(prNumber, reviewer) {
    if (!reviewer) {
      throw new Error("Azure DevOps has no default reviewer: a reviewer email or unique name is required.");
    }
    runAzdo(
      ["pr", "reviewers", "add", reviewer, ...prArgs(prNumber)],
      `Failed to add ${reviewer} as reviewer of PR #${String(prNumber)}.`,
    );
  },

  postIssueComment(issueNumber, body) {
    if (body.length > AZDO_MAX_ARGV_COMMENT_CHARS) {
      throw new Error(
        `The comment is ${String(body.length)} characters; Azure DevOps comments are passed on the command line and are limited to ${String(AZDO_MAX_ARGV_COMMENT_CHARS)}.`,
      );
    }
    const stdout = runAzdo(
      ["comments", "add", String(issueNumber), body, "--markdown", "--json"],
      `Failed to post a comment on work item #${String(issueNumber)}.`,
    );
    try {
      const url = (JSON.parse(stdout) as { url?: unknown }).url;
      return typeof url === "string" ? url : undefined;
    } catch {
      return undefined;
    }
  },

  postPrComment(prNumber, body) {
    runAzdo(
      ["pr", "comment-add", ...prArgs(prNumber), "--file", "-"],
      `Failed to comment on PR #${String(prNumber)}.`,
      body,
    );
  },

  assignIssue(issueNumber, user) {
    runAzdo(["assign", String(issueNumber), user], `Failed to assign work item #${String(issueNumber)} to ${user}.`);
  },

  assignPr() {
    // No PR assignee exists in Azure DevOps; claiming the PR is a documented no-op (docs/azdo-gap.md).
  },
};
