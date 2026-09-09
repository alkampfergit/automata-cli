import { spawnSync } from "node:child_process";
import { hasUncommittedChanges } from "./gitService.js";

/**
 * Put the working tree where a turn needs it.
 *
 * Every function here refuses before touching git when the tree is dirty. That
 * is the one hard rule: `do-work` runs unattended, so it must never stash,
 * reset or otherwise discard uncommitted work it did not create.
 */

export type PrepareFailureReason = "dirty-tree" | "checkout-failed" | "pull-failed";

export type PrepareResult =
  | { ok: true; branch: string }
  | { ok: false; reason: PrepareFailureReason; detail: string };

function git(args: string[]): { stdout: string; stderr: string; status: number } {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new Error("`git` is not installed or not on PATH.");
    }
    throw new Error(err.message);
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status ?? 1 };
}

function dirtyTree(): PrepareResult {
  return {
    ok: false,
    reason: "dirty-tree",
    detail: "the working tree has uncommitted changes; commit or stash them yourself and re-run",
  };
}

/** Put the tree on the base branch, up to date with the remote. */
export function prepareBaseBranch(baseBranch: string): PrepareResult {
  if (hasUncommittedChanges()) return dirtyTree();

  const checkout = git(["checkout", baseBranch]);
  if (checkout.status !== 0) {
    return { ok: false, reason: "checkout-failed", detail: checkout.stderr.trim() };
  }

  const pull = git(["pull", "--ff-only"]);
  if (pull.status !== 0) {
    return { ok: false, reason: "pull-failed", detail: pull.stderr.trim() };
  }

  return { ok: true, branch: baseBranch };
}

/**
 * Put the tree on a pull request's head branch, up to date with the remote,
 * creating the local tracking branch if this checkout has never seen it.
 *
 * The pull is `--ff-only` on purpose: a local branch that has diverged from the
 * remote must fail loudly rather than be silently merged by an unattended tool.
 */
export function preparePrBranch(headRefName: string): PrepareResult {
  if (hasUncommittedChanges()) return dirtyTree();

  const fetch = git(["fetch", "origin", headRefName]);
  if (fetch.status !== 0) {
    return { ok: false, reason: "checkout-failed", detail: fetch.stderr.trim() };
  }

  const checkout = git(["checkout", headRefName]);
  if (checkout.status !== 0) {
    const created = git(["checkout", "-b", headRefName, `origin/${headRefName}`]);
    if (created.status !== 0) {
      return { ok: false, reason: "checkout-failed", detail: created.stderr.trim() };
    }
    return { ok: true, branch: headRefName };
  }

  const pull = git(["pull", "--ff-only", "origin", headRefName]);
  if (pull.status !== 0) {
    return { ok: false, reason: "pull-failed", detail: pull.stderr.trim() };
  }

  return { ok: true, branch: headRefName };
}
