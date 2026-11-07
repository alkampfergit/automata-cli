import type { GitCommandResult } from "./gitService.js";

/**
 * Pure planning for `automata git clean-branches`.
 *
 * Nothing here touches git or `gh`. The caller passes the facts in and gets a
 * plan back, so `--dry-run`, the confirmation prompt and the tests all read the
 * same data. Every question that cannot be answered keeps the branch.
 */

/** Branches that are never deleted, whatever the remote says. */
export const ALWAYS_PROTECTED = ["develop", "master", "main"];

export type CleanupScope = "local" | "remote";

export interface CleanupEntry {
  scope: CleanupScope;
  branch: string;
  action: "delete" | "keep";
  reason: string;
  /** Shown on the same line; the branch is still deleted. */
  warning?: string;
  /** The facts needed to decide could not be read; the run exits 1. */
  failed?: boolean;
}

export interface PullRequestState {
  number: number;
  state: "OPEN" | "CLOSED" | "MERGED";
}

export function protectedBranches(current: string, trunk: string | null): Set<string> {
  const names = new Set(ALWAYS_PROTECTED);
  if (current.length > 0 && current !== "HEAD") names.add(current);
  if (trunk !== null && trunk.length > 0) names.add(trunk);
  return names;
}

function protectedReason(branch: string, current: string): string {
  return branch === current ? "current branch" : "protected branch";
}

/**
 * Local branches with no counterpart on `origin`.
 *
 * `unpushed` is the number of commits that no `origin` branch has, or null when
 * it could not be counted; both only add a warning, the branch is deleted.
 */
export function planLocalCleanup(
  locals: string[],
  remotes: string[],
  protectedSet: Set<string>,
  current: string,
  unpushed: (branch: string) => number | null,
): CleanupEntry[] {
  const onRemote = new Set(remotes);
  return locals.map((branch): CleanupEntry => {
    if (protectedSet.has(branch)) {
      return { scope: "local", branch, action: "keep", reason: protectedReason(branch, current) };
    }
    if (onRemote.has(branch)) {
      return { scope: "local", branch, action: "keep", reason: "has an origin branch" };
    }
    const count = unpushed(branch);
    const entry: CleanupEntry = { scope: "local", branch, action: "delete", reason: "no origin branch" };
    if (count === null) entry.warning = "could not count unpushed commits";
    else if (count > 0) entry.warning = `${String(count)} unpushed commit(s) will be lost`;
    return entry;
  });
}

function numbers(prs: PullRequestState[]): string {
  return prs.map((pr) => `#${String(pr.number)}`).join(", ");
}

/**
 * `origin` branches whose pull requests are all closed or merged.
 *
 * `lookup` returns the same-repository pull requests of a head branch, or null
 * when they could not be read.
 */
export function planRemoteCleanup(
  remotes: string[],
  protectedSet: Set<string>,
  current: string,
  lookup: (branch: string) => PullRequestState[] | null,
): CleanupEntry[] {
  return remotes.map((branch): CleanupEntry => {
    if (protectedSet.has(branch)) {
      return { scope: "remote", branch, action: "keep", reason: protectedReason(branch, current) };
    }
    const prs = lookup(branch);
    if (prs === null) {
      return { scope: "remote", branch, action: "keep", reason: "pull request lookup failed", failed: true };
    }
    const open = prs.filter((pr) => pr.state === "OPEN");
    if (open.length > 0) {
      return { scope: "remote", branch, action: "keep", reason: `open pull request ${numbers(open)}` };
    }
    if (prs.length === 0) {
      return { scope: "remote", branch, action: "keep", reason: "no pull request" };
    }
    return { scope: "remote", branch, action: "delete", reason: `closed pull request ${numbers(prs)}` };
  });
}

export function formatEntry(entry: CleanupEntry, dryRun: boolean): string {
  let verb = "keep";
  if (entry.action === "delete") verb = dryRun ? "would delete" : "delete";
  const warning = entry.warning === undefined ? "" : ` [warning: ${entry.warning}]`;
  return `  ${verb.padEnd(12)} ${entry.scope.padEnd(6)} ${entry.branch} (${entry.reason})${warning}`;
}

export interface Deleters {
  local: (branch: string) => GitCommandResult;
  remote: (branch: string) => GitCommandResult;
}

export interface DeletionOutcome {
  entry: CleanupEntry;
  ok: boolean;
  message: string;
}

/** Runs every planned deletion. A failure is recorded and does not stop the rest. */
export function executeDeletions(entries: CleanupEntry[], deleters: Deleters): DeletionOutcome[] {
  return entries
    .filter((entry) => entry.action === "delete")
    .map((entry) => {
      const result = deleters[entry.scope](entry.branch);
      return { entry, ok: result.ok, message: result.stderr };
    });
}
