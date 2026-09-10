import {
  hasUncommittedChanges,
  checkoutBranch,
  createTrackingBranch,
  fetchBranch,
  pullFastForwardOnly,
  revParse,
  isAncestorCommit,
  resetHardTo,
} from "./gitService.js";
import { RUN_LOCK_RELATIVE_PATH } from "../run/runLock.js";

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
  if (hasUncommittedChanges([RUN_LOCK_RELATIVE_PATH])) return dirtyTree();

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
 * Take a diverged pull-request branch back to the remote, but only when the
 * divergence cannot have destroyed anything a turn made here.
 *
 * Whoever owns a pull-request branch rewrites it — Dependabot force pushes
 * every rebase, and `pr-orphan` turns run on exactly those branches. Once a
 * checkout has seen the old tip, `git pull --ff-only` fails on it forever, so
 * without this the turn is refused on every later tick until a human resets the
 * branch by hand.
 *
 * The condition is what makes the reset safe: the local tip must already have
 * been part of the remote history as this checkout last saw it, before the
 * fetch above moved the remote-tracking ref. Every commit the local branch
 * holds therefore came from the remote, so none of it is work a turn committed
 * here and failed to push. Returns null when that cannot be established, and
 * the caller refuses instead.
 */
function resetToForcePushedRemote(headRefName: string, previousRemoteSha: string | null): PrepareResult | null {
  const localSha = revParse(`refs/heads/${headRefName}`);
  if (previousRemoteSha === null || localSha === null) return null;
  if (!isAncestorCommit(localSha, previousRemoteSha)) return null;

  const reset = resetHardTo(`refs/remotes/origin/${headRefName}`);
  if (!reset.ok) {
    return { ok: false, reason: "pull-failed", detail: reset.stderr };
  }
  return { ok: true, branch: headRefName };
}

/**
 * Put the tree on a pull request's head branch, up to date with the remote,
 * creating the local tracking branch if this checkout has never seen it.
 */
export function preparePrBranch(headRefName: string): PrepareResult {
  if (hasUncommittedChanges([RUN_LOCK_RELATIVE_PATH])) return dirtyTree();

  // Read before the fetch, which is the only chance to learn where the remote
  // was: the fetch is forced, so it overwrites this ref with the new tip.
  const previousRemoteSha = revParse(`refs/remotes/origin/${headRefName}`);

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
    const reset = resetToForcePushedRemote(headRefName, previousRemoteSha);
    if (reset !== null) return reset;
    return {
      ok: false,
      reason: "pull-failed",
      detail:
        `${pull.stderr} — the local ${headRefName} has commits origin/${headRefName} does not, so it was ` +
        `not reset automatically; inspect them and \`git reset --hard origin/${headRefName}\` yourself`,
    };
  }

  return { ok: true, branch: headRefName };
}
