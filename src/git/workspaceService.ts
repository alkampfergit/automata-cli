import {
  hasUncommittedChanges,
  checkoutBranch,
  createTrackingBranch,
  fetchBranch,
  pullFastForwardOnly,
} from "./gitService.js";

/**
 * Put the working tree where a turn needs it.
 *
 * Every function here refuses before touching git when the tree is dirty. That
 * is the one hard rule: `do-work` runs unattended, so it must never stash,
 * reset or otherwise discard uncommitted work it did not create.
 *
 * The git invocations themselves live in `gitService`, which owns the process
 * runner for this project; this module only sequences them and maps failures
 * onto an outcome the tick loop can act on.
 */

export type PrepareFailureReason = "dirty-tree" | "checkout-failed" | "pull-failed";

export type PrepareResult =
  | { ok: true; branch: string }
  | { ok: false; reason: PrepareFailureReason; detail: string };

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

  const checkout = checkoutBranch(baseBranch);
  if (!checkout.ok) {
    return { ok: false, reason: "checkout-failed", detail: checkout.stderr };
  }

  const pull = pullFastForwardOnly();
  if (!pull.ok) {
    return { ok: false, reason: "pull-failed", detail: pull.stderr };
  }

  return { ok: true, branch: baseBranch };
}

/**
 * Put the tree on a pull request's head branch, up to date with the remote,
 * creating the local tracking branch if this checkout has never seen it.
 */
export function preparePrBranch(headRefName: string): PrepareResult {
  if (hasUncommittedChanges()) return dirtyTree();

  const fetched = fetchBranch(headRefName);
  if (!fetched.ok) {
    return { ok: false, reason: "checkout-failed", detail: fetched.stderr };
  }

  const checkout = checkoutBranch(headRefName);
  if (!checkout.ok) {
    const created = createTrackingBranch(headRefName);
    if (!created.ok) {
      return { ok: false, reason: "checkout-failed", detail: created.stderr };
    }
    return { ok: true, branch: headRefName };
  }

  const pull = pullFastForwardOnly(headRefName);
  if (!pull.ok) {
    return { ok: false, reason: "pull-failed", detail: pull.stderr };
  }

  return { ok: true, branch: headRefName };
}
