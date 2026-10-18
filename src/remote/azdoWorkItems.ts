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
/** The most work items `azdo list-items --top` accepts. */
const MAX_FETCH = 1000;

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

function fetchWorkItems(technique: IssueDiscoveryTechnique, value: string, top: number): AzdoWorkItem[] {
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
  try {
    return JSON.parse(result.stdout ?? "") as AzdoWorkItem[];
  } catch {
    throw new Error("Could not parse the work item list returned by `azdo list-items`.");
  }
}

/**
 * Open work items that match the discovery technique, newest change first, in the shape the GitHub issue list uses.
 * `description` is markdown (azdo-cli converts it). A full batch that holds too few open items is fetched again
 * with a larger window, up to the backend maximum; if that is still not enough, the result is reported as incomplete.
 */
export function listWorkItems(technique: IssueDiscoveryTechnique, value: string, limit = 10): GitHubIssue[] {
  let top = Math.min(Math.max(limit * FETCH_FACTOR, MIN_FETCH), MAX_FETCH);
  for (;;) {
    const items = fetchWorkItems(technique, value, top);
    const open = items.filter((item) => !CLOSED_STATES.has(item.state.toLowerCase()));
    const hidden = items.length >= top;
    if (open.length >= limit || !hidden) return toIssues(open, limit);
    if (top < MAX_FETCH) {
      top = Math.min(top * FETCH_FACTOR, MAX_FETCH);
      continue;
    }
    if (open.length === 0) {
      throw new Error(`The newest ${MAX_FETCH} matching work items are all closed, so discovery is incomplete. Narrow the discovery value.`);
    }
    process.stderr.write(`Warning: only the newest ${MAX_FETCH} matching work items were searched; more open work items may exist.\n`);
    return toIssues(open, limit);
  }
}

function toIssues(open: AzdoWorkItem[], limit: number): GitHubIssue[] {
  return open
    .slice(0, limit)
    .map((item) => ({ number: item.id, title: item.title, body: item.description ?? "", url: item.url }));
}
