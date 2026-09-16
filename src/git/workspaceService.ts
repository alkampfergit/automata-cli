import {
  hasUncommittedChanges,
  checkoutBranch,
  createTrackingBranch,
  fetchBranch,
  pullFastForwardOnly,
  revParse,
  isAncestorCommit,
  resetHardTo,
  describeDivergence,
  rebaseOnto,
  abortRebase,
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

export type PrepareFailureReason =
  | "dirty-tree"
  | "checkout-failed"
  | "pull-failed"
  | "rebase-conflict";

/**
 * How a branch was brought up to its remote.
 *
 * Named on the result rather than inferred by the caller because every one of
 * these is an explicit git command chosen here: nothing this module does may
 * depend on the `pull.rebase` / `pull.ff` configuration of the machine running
 * the loop, which is exactly how a diverged branch became unrecoverable.
 */
export type SyncStrategy =
  /** `git pull --ff-only` succeeded — the ordinary case. */
  | "fast-forward"
  /** The local branch did not exist and was created from the remote. */
  | "tracking-branch"
  /** The remote was force-pushed and every local commit demonstrably came from it. */
  | "reset-to-remote"
  /** Every local-only commit is already upstream as the same patch, so it was replayed away. */
  | "rebase";

export type PrepareResult =
  | { ok: true; branch: string; strategy: SyncStrategy }
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

  return { ok: true, branch: baseBranch, strategy: "fast-forward" };
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
  return { ok: true, branch: headRefName, strategy: "reset-to-remote" };
}

/**
 * Take a diverged branch back to the remote by replaying it, but only when the
 * replay demonstrably has nothing to carry.
 *
 * The case this exists for: the same change reached the remote under a
 * different sha — someone rebased the pull request, a bot re-applied a fix, a
 * squash landed upstream. The local tip is then neither an ancestor of the old
 * remote (so `resetToForcePushedRemote` refuses) nor of the new one (so
 * `--ff-only` refuses), and the branch is stuck for good even though both tips
 * carry identical content.
 *
 * `git cherry` answers the only question that makes a rebase safe here: is
 * every local-only commit already part of the upstream history as the same
 * patch? When it is, the rebase replays nothing and lands on the remote tip.
 * When even one commit is new — work a turn committed here and never pushed —
 * this refuses, because rewriting it would leave a branch that could only be
 * published by force-pushing over a human's work.
 *
 * Merge commits are refused outright: `git cherry` cannot compute a patch-id
 * for one and leaves it out of its output entirely, so unpushed content behind
 * a local merge would otherwise read as "nothing to lose".
 *
 * Returns null when the branch is not a case this can act on, and the caller
 * refuses instead.
 */
function rebaseOntoAlreadyAppliedRemote(headRefName: string): PrepareResult | null {
  const upstream = `refs/remotes/origin/${headRefName}`;
  const divergence = describeDivergence(upstream, `refs/heads/${headRefName}`);
  if (divergence === null) return null;
  if (divergence.merges > 0) return null;
  // Nothing local-only, yet the fast-forward failed: whatever is wrong with
  // this branch is not the divergence this understands.
  if (divergence.commits.length === 0) return null;
  if (divergence.commits.some((commit) => !commit.alreadyUpstream)) return null;

  const rebase = rebaseOnto(upstream);
  if (!rebase.ok) {
    // Leaving a rebase in progress would make the next tick see a conflicted
    // index, i.e. a dirty tree, and refuse *every* item rather than this one.
    const aborted = abortRebase();
    const restored = aborted.ok
      ? `the rebase was aborted, so ${headRefName} is back where it was`
      : `the rebase could NOT be aborted (${aborted.stderr}) — run \`git rebase --abort\` in the checkout`;
    return {
      ok: false,
      reason: "rebase-conflict",
      detail: `${rebase.stderr} — ${restored}`,
    };
  }

  return { ok: true, branch: headRefName, strategy: "rebase" };
}

/** The refusal of last resort: say what was found, and what to run. */
function divergenceRefusal(headRefName: string, pullError: string): PrepareResult {
  const divergence = describeDivergence(
    `refs/remotes/origin/${headRefName}`,
    `refs/heads/${headRefName}`,
  );
  const unpushed =
    divergence === null
      ? "the local commits could not be listed"
      : `${String(divergence.commits.filter((c) => !c.alreadyUpstream).length + divergence.merges)} of its ` +
        `commits are not on origin/${headRefName}`;
  return {
    ok: false,
    reason: "pull-failed",
    detail:
      `${pullError} — the local ${headRefName} has diverged from origin/${headRefName} and ${unpushed}, so it ` +
      `was not synchronized automatically; inspect them with \`git log origin/${headRefName}..${headRefName}\` ` +
      `and \`git reset --hard origin/${headRefName}\` yourself once they are safe to lose`,
  };
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
    return { ok: true, branch: headRefName, strategy: "tracking-branch" };
  }

  const pull = pullFastForwardOnly(headRefName);
  if (!pull.ok) {
    // Ordered cheapest and most conservative first. Both recoveries below run
    // only where a fast-forward has already failed, so neither can change what
    // an ordinary branch does.
    const reset = resetToForcePushedRemote(headRefName, previousRemoteSha);
    if (reset !== null) return reset;

    const rebased = rebaseOntoAlreadyAppliedRemote(headRefName);
    if (rebased !== null) return rebased;

    return divergenceRefusal(headRefName, pull.stderr);
  }

  return { ok: true, branch: headRefName, strategy: "fast-forward" };
}
