import { spawnSync } from "node:child_process";
import type { IssueDiscoveryTechnique } from "../config/configStore.js";
import type { GitHubIssue } from "../config/githubService.js";
import { AZDO_NO_UPDATE_CHECK } from "./azdoPrerequisites.js";

interface AzdoWorkItem {
  id: number;
  title: string;
  description: string | null;
  url: string;
  state: string;
}

/** azdo-cli has no "not closed" filter, so these states are dropped here. */
const CLOSED_STATES = new Set(["closed", "done", "removed", "completed"]);

/** The least number of work items requested, so that dropping closed ones still fills the list. */
const MIN_FETCH = 50;
const FETCH_FACTOR = 4;

function filterArgs(technique: IssueDiscoveryTechnique, value: string): string[] {
  switch (technique) {
    case "label":
      return ["--tag", value];
    case "assignee":
      return ["--assigned-to", value];
    case "title-contains":
      return ["--title-contains", value];
  }
}

/**
 * Open work items that match the discovery technique, newest change first, in the shape the GitHub issue list uses.
 * `description` is markdown (azdo-cli converts it).
 */
export function listWorkItems(technique: IssueDiscoveryTechnique, value: string, limit = 10): GitHubIssue[] {
  const top = Math.max(limit * FETCH_FACTOR, MIN_FETCH);
  const args = ["list-items", ...filterArgs(technique, value), "--top", String(top), "--json", AZDO_NO_UPDATE_CHECK];
  // Resolving `azdo` through PATH is the point of the "on PATH" prerequisite.
  const result = spawnSync("azdo", args, { encoding: "utf8" }); // NOSONAR
  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
    throw new Error(err.code === "ENOENT" ? "`azdo` CLI is not installed or not on PATH." : err.message);
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error((result.stderr ?? "").trim() || "Failed to list Azure DevOps work items.");
  }
  let items: AzdoWorkItem[];
  try {
    items = JSON.parse(result.stdout ?? "") as AzdoWorkItem[];
  } catch {
    throw new Error("Could not parse the work item list returned by `azdo list-items`.");
  }
  return items
    .filter((item) => !CLOSED_STATES.has(item.state.toLowerCase()))
    .slice(0, limit)
    .map((item) => ({ number: item.id, title: item.title, body: item.description ?? "", url: item.url }));
}
