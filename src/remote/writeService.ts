import { spawnSync } from "node:child_process";
import {
  addClosesRefToPr,
  addCopilotReviewer,
  getCurrentBranchPr as ghGetCurrentBranchPr,
  postComment,
} from "../config/githubService.js";
import { assignIssueToAgent, assignPrToAgent, postMarker } from "../github/ghWorkService.js";
import { selectBackend } from "./backend.js";
import { azdoWriteService } from "./azdoWriteService.js";
import type { RemoteType } from "../config/configStore.js";

export interface CurrentBranchPr {
  number: number;
  url: string;
  body: string;
  assignees: string[];
}

/** The write operations that finish a piece of work, with the same shapes the GitHub callers use. */
export interface RemoteWriteService {
  getCurrentBranchPr(branch?: string): CurrentBranchPr | null;
  updatePrDescription(prNumber: number, body: string): void;
  /** Makes the PR close (GitHub) or reference (Azure DevOps) the issue / work item. */
  linkPrToIssue(prNumber: number, issueNumber: number): void;
  /** `reviewer` is required in Azure DevOps; GitHub always asks Copilot. */
  requestReview(prNumber: number, reviewer?: string): void;
  /** Returns the comment URL when the backend reports one. */
  postIssueComment(issueNumber: number, body: string): string | undefined;
  postPrComment(prNumber: number, body: string): void;
  assignIssue(issueNumber: number, user: string): void;
  assignPr(prNumber: number, user: string): void;
}

const githubWriteService: RemoteWriteService = {
  getCurrentBranchPr: ghGetCurrentBranchPr,
  updatePrDescription(prNumber, body) {
    // Resolving `gh` through PATH is the point of the "on PATH" prerequisite.
    const result = spawnSync("gh", ["pr", "edit", String(prNumber), "--body-file", "-"], { encoding: "utf8", input: body }); // NOSONAR
    if (result.error || result.status !== 0) {
      throw new Error(
        (result.stderr ?? "").trim() || result.error?.message || `Failed to update PR #${String(prNumber)} body.`,
      );
    }
  },
  linkPrToIssue: addClosesRefToPr,
  requestReview: (prNumber) => addCopilotReviewer(prNumber),
  postIssueComment: postComment,
  postPrComment(prNumber, body) {
    postMarker("pr", prNumber, body);
  },
  assignIssue: assignIssueToAgent,
  assignPr: assignPrToAgent,
};

/** The one place that picks the write backend; an absent `remoteType` is GitHub. */
export function selectWriteService(config: { remoteType?: RemoteType }): RemoteWriteService {
  return selectBackend(config) === "azdo" ? azdoWriteService : githubWriteService;
}
