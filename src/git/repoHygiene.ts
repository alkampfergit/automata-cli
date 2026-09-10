import {
  checkoutBranch,
  commitStaged,
  countCommitsNotIn,
  createBranchAtHead,
  forceDeleteLocalBranch,
  getCurrentBranch,
  hasUncommittedChanges,
  listLocalBranches,
  listRemoteBranches,
  pullFastForwardOnly,
  pushSetUpstream,
  stageAllExcept,
} from "./gitService.js";
import {
  createDraftPullRequest,
  listPullRequestsForHead,
  type PullRequestHeadRef,
} from "../github/ghWorkService.js";
import { RUN_LOCK_RELATIVE_PATH } from "../run/runLock.js";

/**
 * Put the *repository* where a tick needs it, once per tick.
 *
 * `workspaceService` is the per-item sibling of this module: it refuses to touch
 * a dirty tree, which is right for a single work item but leaves the loop
 * stalled until a human intervenes. This module runs first and removes the
 * reason to refuse — it commits and pushes the uncommitted work rather than
 * discarding it, fast-forwards the base branch, and deletes the local branches
 * that provably carry nothing the base branch does not already have.
 *
 * The one hard rule is inherited unchanged: nothing here may discard work. No
 * step stashes, resets, cleans, force-checkouts or merges, and a branch is
 * deleted only on positive evidence that it is finished — a merged pull
 * request, a pull request closed unmerged (whose commits GitHub keeps at
 * `refs/pull/<n>/head`), or a *confirmed* zero unmerged commits. Every
 * uncertainty (unreachable remote, failed lookup, unparseable count, failed
 * push) keeps the branch.
 *
 * The git and `gh` invocations live in `gitService` and `ghWorkService`, which
 * own the process runners; this module only sequences them and decides.
 */

/** Label put on pull requests this module opens, so they are easy to filter out. */
export const RESCUE_PR_LABEL = "rescue";

const RESCUE_BRANCH_PREFIX = "rescue/";

export interface HygieneOptions {
  baseBranch: string;
  /** Branch names that are never deletion candidates. */
  protectedBranches: string[];
  /** Report every step without issuing a single mutating command. */
  dryRun: boolean;
  /** Progress sink, so the caller keeps ownership of its stdout/stderr split. */
  log: (message: string) => void;
}

export type RescueStep = "branch" | "stage" | "commit" | "push" | "pr";

export type RescueOutcome =
  | { kind: "clean" }
  | {
      kind: "rescued";
      branch: string;
      createdBranch: boolean;
      /** Never null: a rescue whose pull request could not be resolved is `failed`. */
      pr: number;
      prUrl: string;
      prCreated: boolean;
    }
  | { kind: "would-rescue"; branch: string; createdBranch: boolean }
  | { kind: "failed"; step: RescueStep; detail: string };

export type BaseOutcome = { ok: true } | { ok: false; step: "checkout" | "pull"; detail: string };

export type PruneKeptReason = "open-pr" | "lookup-failed" | "push-failed" | "delete-failed";

export type PruneOutcome =
  | { kind: "deleted"; branch: string }
  | { kind: "would-delete"; branch: string }
  | { kind: "kept"; branch: string; reason: PruneKeptReason; detail: string }
  /** Pushed and kept. `pr` is null when the branch is safe but the draft PR could not be opened. */
  | { kind: "rescued"; branch: string; pr: number | null; prUrl: string | null }
  | { kind: "would-rescue"; branch: string; unmergedCommits: number };

export interface HygieneReport {
  rescue: RescueOutcome;
  base: BaseOutcome;
  prunes: PruneOutcome[];
  /** True when any step failed. Derived from the outcomes above. */
  degraded: boolean;
}

/**
 * Second-resolution UTC, compact: `20260910T054512Z`.
 *
 * Sortable, filename-safe and unambiguous across machines, which matters
 * because these branch names end up on the shared remote.
 */
function utcStamp(now: Date): string {
  return now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
}

/** `feature/031-foo` → `feature-031-foo`, so the rescue prefix stays one level deep. */
function flattenBranchName(branch: string): string {
  return branch.replaceAll("/", "-");
}

function detectRescueTarget(
  baseBranch: string,
  now: Date,
): { branch: string; createdBranch: boolean; source: string } {
  // `rev-parse --abbrev-ref HEAD` answers "HEAD" on a detached head, which has
  // no branch to commit onto — so it takes the same path as the base branch.
  const current = getCurrentBranch();
  const detached = current === "HEAD" || current.length === 0;
  if (!detached && current !== baseBranch) {
    return { branch: current, createdBranch: false, source: current };
  }
  const source = detached ? "detached HEAD" : baseBranch;
  const label = detached ? "detached" : flattenBranchName(baseBranch);
  return {
    branch: `${RESCUE_BRANCH_PREFIX}${label}-${utcStamp(now)}`,
    createdBranch: true,
    source,
  };
}

function rescueBody(source: string): string {
  return (
    "Opened by `automata do-work`'s repository-hygiene pre-flight because this branch carried " +
    "work that existed only in the local checkout.\n\n" +
    `Source: \`${source}\`.\n\n` +
    "It is a draft and references no issue: nothing here is claimed to be finished, it is here " +
    "so it cannot be lost. Review it, fold it into the right pull request, or close it."
  );
}

/** Find the open pull request for a head branch, or null. Throws if `gh` fails. */
function findOpenPr(branch: string): PullRequestHeadRef | null {
  const prs = listPullRequestsForHead(branch);
  return prs.find((pr) => pr.state === "OPEN") ?? null;
}

/**
 * Commit, push and open a draft pull request for whatever is uncommitted.
 *
 * Every step is additive, so a failure at any point leaves the tree exactly as
 * dirty as it was — which is the pre-existing behaviour the per-item guard
 * already handles.
 */
function rescueUncommittedChanges(options: HygieneOptions, now: Date): RescueOutcome {
  if (!hasUncommittedChanges([RUN_LOCK_RELATIVE_PATH])) {
    options.log("  rescue    nothing to do; the working tree is clean\n");
    return { kind: "clean" };
  }

  const target = detectRescueTarget(options.baseBranch, now);

  if (options.dryRun) {
    options.log(
      target.createdBranch
        ? `  rescue    would create ${target.branch} off ${target.source}, commit the uncommitted changes, push it and open a draft PR\n`
        : `  rescue    would commit the uncommitted changes onto ${target.branch}, push it and open a draft PR if it has none open\n`,
    );
    return { kind: "would-rescue", branch: target.branch, createdBranch: target.createdBranch };
  }

  if (target.createdBranch) {
    const created = createBranchAtHead(target.branch);
    if (!created.ok) {
      options.log(`  rescue    FAILED to create ${target.branch}: ${created.stderr}\n`);
      return { kind: "failed", step: "branch", detail: created.stderr };
    }
  }

  // Excluding the lock this very run created: committing it would put a pid in
  // the branch and leave the next tick's tree dirty for a file we just added.
  const staged = stageAllExcept([RUN_LOCK_RELATIVE_PATH]);
  if (!staged.ok) {
    options.log(`  rescue    FAILED to stage the changes: ${staged.stderr}\n`);
    return { kind: "failed", step: "stage", detail: staged.stderr };
  }

  const committed = commitStaged(`chore(automata): rescue uncommitted work from ${target.source}`);
  if (!committed.ok) {
    options.log(`  rescue    FAILED to commit: ${committed.stderr}\n`);
    return { kind: "failed", step: "commit", detail: committed.stderr };
  }

  const pushed = pushSetUpstream(target.branch);
  if (!pushed.ok) {
    options.log(`  rescue    FAILED to push ${target.branch}: ${pushed.stderr}\n`);
    return { kind: "failed", step: "push", detail: pushed.stderr };
  }

  // Pushed, so the work is safe from here on: a pull-request failure below is
  // worth reporting but has cost nothing.
  let existing: PullRequestHeadRef | null;
  try {
    existing = findOpenPr(target.branch);
  } catch (err) {
    options.log(
      `  rescue    committed and pushed ${target.branch}, but could not check for an open PR: ${(err as Error).message}\n`,
    );
    return { kind: "failed", step: "pr", detail: (err as Error).message };
  }

  if (existing !== null) {
    options.log(
      `  rescue    committed and pushed ${target.branch}; PR #${String(existing.number)} is already open\n`,
    );
    return {
      kind: "rescued",
      branch: target.branch,
      createdBranch: target.createdBranch,
      pr: existing.number,
      prUrl: existing.url,
      prCreated: false,
    };
  }

  try {
    const pr = createDraftPullRequest({
      head: target.branch,
      base: options.baseBranch,
      title: `rescue: uncommitted work from ${target.source}`,
      body: rescueBody(target.source),
      label: RESCUE_PR_LABEL,
    });
    options.log(
      `  rescue    committed and pushed ${target.branch}; opened draft PR #${String(pr.number)}\n`,
    );
    return {
      kind: "rescued",
      branch: target.branch,
      createdBranch: target.createdBranch,
      pr: pr.number,
      prUrl: pr.url,
      prCreated: true,
    };
  } catch (err) {
    options.log(
      `  rescue    committed and pushed ${target.branch}, but could not open a draft PR: ${(err as Error).message}\n`,
    );
    return { kind: "failed", step: "pr", detail: (err as Error).message };
  }
}

/** Check out the base branch and fast-forward it, on every tick. */
function prepareBase(options: HygieneOptions): BaseOutcome {
  if (options.dryRun) {
    options.log(`  base      would check out ${options.baseBranch} and pull --ff-only\n`);
    return { ok: true };
  }

  const checkout = checkoutBranch(options.baseBranch);
  if (!checkout.ok) {
    options.log(`  base      FAILED to check out ${options.baseBranch}: ${checkout.stderr}\n`);
    return { ok: false, step: "checkout", detail: checkout.stderr };
  }

  // Fast-forward only: a diverged base branch is a situation for a human, not
  // something an unattended tool should resolve with a merge.
  const pull = pullFastForwardOnly();
  if (!pull.ok) {
    options.log(`  base      FAILED to pull ${options.baseBranch}: ${pull.stderr}\n`);
    return { ok: false, step: "pull", detail: pull.stderr };
  }

  options.log(`  base      ${options.baseBranch} checked out and up to date\n`);
  return { ok: true };
}

/**
 * The local branches that could be pruned: absent from `origin`, and not one of
 * the branches we must never touch.
 *
 * Returns null when `origin` could not be listed — absence from an unread list
 * is not evidence that a branch has no remote.
 */
function collectCandidates(options: HygieneOptions): string[] | null {
  const remote = listRemoteBranches();
  if (remote === null) return null;
  const remoteNames = new Set(remote);

  // The current branch is excluded because `git branch -D` cannot delete it —
  // and after `prepareBase` it is the base branch anyway, so this is belt and
  // braces for the case where the checkout failed.
  const current = getCurrentBranch();
  const untouchable = new Set([options.baseBranch, current, ...options.protectedBranches]);

  return listLocalBranches().filter(
    (branch) => !untouchable.has(branch) && !remoteNames.has(branch),
  );
}

/**
 * Delete a branch that has been shown to be finished, or report why it stayed.
 *
 * `why` is the evidence that made it safe, quoted back into the log so an
 * operator reviewing a deletion can see which rule fired.
 */
function deleteOrReport(branch: string, options: HygieneOptions, why: string): PruneOutcome {
  if (options.dryRun) {
    options.log(`  prune     would delete ${branch} (no remote, ${why})\n`);
    return { kind: "would-delete", branch };
  }
  const deleted = forceDeleteLocalBranch(branch);
  if (!deleted.ok) {
    options.log(`  prune     kept ${branch}: delete failed — ${deleted.stderr}\n`);
    return { kind: "kept", branch, reason: "delete-failed", detail: deleted.stderr };
  }
  options.log(`  prune     deleted ${branch} (${why})\n`);
  return { kind: "deleted", branch };
}

function pruneCandidate(branch: string, options: HygieneOptions): PruneOutcome {
  let prs: PullRequestHeadRef[];
  try {
    prs = listPullRequestsForHead(branch);
  } catch (err) {
    const detail = (err as Error).message;
    options.log(`  prune     kept ${branch}: could not read its pull requests — ${detail}\n`);
    return { kind: "kept", branch, reason: "lookup-failed", detail };
  }

  const openPr = prs.find((pr) => pr.state === "OPEN") ?? null;
  if (openPr !== null) {
    options.log(`  prune     kept ${branch}: PR #${String(openPr.number)} is open\n`);
    return {
      kind: "kept",
      branch,
      reason: "open-pr",
      detail: `PR #${String(openPr.number)} is open`,
    };
  }

  // A merged pull request is authoritative: GitHub says the work landed, so the
  // branch is finished whatever `rev-list` says. It has to be checked *before*
  // the reachability count, because this repository squash-merges — the change
  // is in the base branch while none of the branch's own commits are, so the
  // count is high for exactly the branches that are most safely deletable.
  const merged = prs.find((pr) => pr.state === "MERGED") ?? null;
  if (merged !== null) {
    return deleteOrReport(branch, options, `PR #${String(merged.number)} was merged`);
  }

  // Closing a pull request without merging is a decision a human made about
  // this branch: the work is not wanted on the base branch. That settles the
  // branch as finished just as a merge does, so the commit count is not
  // consulted — it would only ever re-open work that was deliberately dropped.
  //
  // It does not discard anything: the head commits of a pull request stay
  // fetchable from GitHub as `refs/pull/<number>/head` after the branch is
  // gone, so the closed pull request is itself the durable copy.
  const closed = prs.find((pr) => pr.state === "CLOSED") ?? null;
  if (closed !== null) {
    return deleteOrReport(branch, options, `PR #${String(closed.number)} was closed unmerged`);
  }

  // No pull request at all: nothing external says anything about this branch,
  // so only the commit count can prove the work is already in the base branch.
  const unmerged = countCommitsNotIn(options.baseBranch, branch);
  if (unmerged === null) {
    const detail = `could not count commits outside ${options.baseBranch}`;
    options.log(`  prune     kept ${branch}: ${detail}\n`);
    return { kind: "kept", branch, reason: "lookup-failed", detail };
  }

  if (unmerged === 0) {
    return deleteOrReport(branch, options, `nothing outside ${options.baseBranch}`);
  }

  if (options.dryRun) {
    options.log(
      `  prune     would push ${branch} and open a draft PR (${String(unmerged)} commit(s) outside ${options.baseBranch}), keeping the branch\n`,
    );
    return { kind: "would-rescue", branch, unmergedCommits: unmerged };
  }

  const pushed = pushSetUpstream(branch);
  if (!pushed.ok) {
    options.log(
      `  prune     kept ${branch}: has ${String(unmerged)} commit(s) outside ${options.baseBranch} and could not be pushed — ${pushed.stderr}\n`,
    );
    return { kind: "kept", branch, reason: "push-failed", detail: pushed.stderr };
  }

  try {
    const pr = createDraftPullRequest({
      head: branch,
      base: options.baseBranch,
      title: `rescue: unmerged commits on ${branch}`,
      body: rescueBody(branch),
      label: RESCUE_PR_LABEL,
    });
    options.log(
      `  prune     rescued ${branch}: pushed and opened draft PR #${String(pr.number)}\n`,
    );
    return { kind: "rescued", branch, pr: pr.number, prUrl: pr.url };
  } catch (err) {
    // Pushed but unreviewed is still safe; the branch stays either way.
    options.log(
      `  prune     rescued ${branch}: pushed, but could not open a draft PR — ${(err as Error).message}\n`,
    );
    return { kind: "rescued", branch, pr: null, prUrl: null };
  }
}

function prune(options: HygieneOptions): { outcomes: PruneOutcome[]; remoteUnreadable: boolean } {
  const candidates = collectCandidates(options);
  if (candidates === null) {
    options.log(
      "  prune     skipped: could not list origin's branches, so no branch can be shown to have no remote\n",
    );
    return { outcomes: [], remoteUnreadable: true };
  }
  if (candidates.length === 0) {
    options.log("  prune     nothing to do; every local branch exists on origin\n");
    return { outcomes: [], remoteUnreadable: false };
  }
  return {
    outcomes: candidates.map((branch) => pruneCandidate(branch, options)),
    remoteUnreadable: false,
  };
}

/**
 * The once-per-tick pre-flight, in the only order that is safe:
 *
 * 1. rescue — before the base checkout, because it works on the current HEAD;
 * 2. base — so "the current branch" the prune must not delete is the base branch;
 * 3. prune — after the rescue, so a branch whose commits were just pushed is no
 *    longer a candidate, and before any work item, so it cannot delete a branch
 *    a run has just created.
 */
export function runRepoHygiene(options: HygieneOptions, now: Date = new Date()): HygieneReport {
  options.log(options.dryRun ? "\nPre-flight (dry run):\n" : "\nPre-flight:\n");

  const rescue = rescueUncommittedChanges(options, now);
  const base = prepareBase(options);
  const { outcomes, remoteUnreadable } = prune(options);

  // Every reported failure has to show up here, or the tick exits 0 while the
  // log says a step failed. A pushed branch without its draft pull request is
  // one of them: the work is safe, but a human still has to finish the job.
  const degraded =
    rescue.kind === "failed" ||
    !base.ok ||
    remoteUnreadable ||
    outcomes.some(
      (outcome) =>
        (outcome.kind === "kept" && outcome.reason !== "open-pr") ||
        (outcome.kind === "rescued" && outcome.pr === null),
    );

  return { rescue, base, prunes: outcomes, degraded };
}
