import { spawnSync } from "node:child_process";
import { RUN_LOCK_RELATIVE_PATH } from "../run/runLock.js";
import { resolveCommand } from "../cli/spawnUtils.js";

/**
 * A read-only view of the checkout, for `do-work --check`.
 *
 * Separate from `repoHygiene.ts` on purpose. The pre-flight's dry-run mode
 * describes the *mutations it would perform* — which branch it would rescue
 * onto, which it would delete — and it still fetches and prunes on the way. This
 * module instead describes the state, and the only commands it is allowed to
 * issue are ref reads plus one optional `git fetch` that writes a
 * remote-tracking ref and nothing else. Keeping that list short and in one file
 * is what makes "the check cannot modify the working copy" reviewable rather
 * than merely intended.
 */

/**
 * Resolved once against `PATH` rather than left for `spawnSync` to search on
 * every call, so the binary this module runs is decided here and is the same
 * for every command in the report.
 */
const GIT_BIN = resolveCommand("git");

function git(args: string[]): GitResult {
  const result = spawnSync(GIT_BIN, args, { encoding: "utf8" });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? 1,
  };
}

interface GitResult {
  stdout: string;
  stderr: string;
  status: number;
}

export interface RepoStatusOptions {
  /** The branch every turn is cut from; the one whose divergence stops work. */
  baseBranch: string;
  /** False leaves the remote-tracking ref where it was and reports `refreshed: false`. */
  fetch: boolean;
}

export interface RepoStatus {
  /** Null when HEAD is detached. */
  branch: string | null;
  /** Short sha of HEAD, or null in a repository with no commits. */
  head: string | null;
  /** `git status --porcelain` entries, minus automata's own lock file. */
  dirtyPaths: string[];
  baseBranch: string;
  /** Does `refs/heads/<base>` exist in this checkout? */
  baseLocal: boolean;
  /** The base branch's upstream, e.g. `origin/develop`; null when it has none. */
  upstream: string | null;
  /** The base branch against its upstream. Null when either side is missing. */
  ahead: number | null;
  behind: number | null;
  /** Whether the remote-tracking ref was updated during this inspection. */
  refreshed: boolean;
  /** The fetch's stderr when it failed; null when it succeeded or was skipped. */
  fetchError: string | null;
  /** Set when the working directory is not a git repository at all. */
  error: string | null;
}

function notARepo(baseBranch: string, detail: string): RepoStatus {
  return {
    branch: null,
    head: null,
    dirtyPaths: [],
    baseBranch,
    baseLocal: false,
    upstream: null,
    ahead: null,
    behind: null,
    refreshed: false,
    fetchError: null,
    error: detail,
  };
}

/**
 * The lock file is automata's own, created before the tick's cleanliness check
 * for exactly this reason. A repository that has not added it to `.gitignore`
 * would otherwise be reported as dirty by the very command that inspects it.
 */
function isOwnLockFile(porcelainEntry: string): boolean {
  return porcelainEntry.slice(3).trim().endsWith(RUN_LOCK_RELATIVE_PATH);
}

/**
 * Ahead/behind of `branch` against `upstream`.
 *
 * `--left-right --count A...B` prints "<commits only in A>\t<commits only in B>",
 * so with the upstream on the left the first number is *behind* and the second
 * is *ahead*. Getting that pair the wrong way round reports a branch that cannot
 * be fast-forwarded as one that can, so it is spelled out rather than inferred.
 */
function divergence(upstream: string, branch: string): { ahead: number; behind: number } | null {
  const { stdout, status } = git([
    "rev-list",
    "--left-right",
    "--count",
    `${upstream}...${branch}`,
  ]);
  if (status !== 0) return null;
  const parts = stdout.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const behind = Number.parseInt(parts[0], 10);
  const ahead = Number.parseInt(parts[1], 10);
  if (Number.isNaN(behind) || Number.isNaN(ahead)) return null;
  return { ahead, behind };
}

/**
 * HEAD's short sha, plus the fatal detail when this is not a repository at all.
 *
 * `rev-parse` failing on HEAD means either "not a repository" or "no commits
 * yet"; `--is-inside-work-tree` tells them apart, and only the first is fatal to
 * the whole section.
 */
function readHead(): { head: string | null; fatal: string | null } {
  const head = git(["rev-parse", "--short", "HEAD"]);
  if (head.status === 0) return { head: head.stdout.trim(), fatal: null };
  if (git(["rev-parse", "--is-inside-work-tree"]).status === 0) return { head: null, fatal: null };
  return { head: null, fatal: head.stderr.trim() || "not a git repository" };
}

/** `git status --porcelain` entries, minus automata's own lock file. */
function readDirtyPaths(): string[] {
  const porcelain = git(["status", "--porcelain"]);
  if (porcelain.status !== 0) return [];
  return porcelain.stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .filter((line) => !isOwnLockFile(line));
}

/**
 * The one command in this module that writes anything, and it writes a single
 * remote-tracking ref. The same refspec `gitService.fetchBranch` uses, so
 * "refreshed" means the same thing to the check as it does to the tick.
 */
function refreshBase(baseBranch: string): { refreshed: boolean; fetchError: string | null } {
  const fetched = git([
    "fetch",
    "origin",
    `+refs/heads/${baseBranch}:refs/remotes/origin/${baseBranch}`,
  ]);
  if (fetched.status === 0) return { refreshed: true, fetchError: null };
  return { refreshed: false, fetchError: fetched.stderr.trim() || "git fetch failed" };
}

/**
 * The configured upstream when the branch exists locally and has one; otherwise
 * `origin/<base>` if that ref is present, which is the case for a base branch
 * that was fetched but never checked out here.
 */
function resolveUpstream(baseBranch: string, baseLocal: boolean): string | null {
  if (baseLocal) {
    const configured = git([
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      `${baseBranch}@{u}`,
    ]);
    if (configured.status === 0) return configured.stdout.trim();
  }
  if (git(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${baseBranch}`]).status === 0) {
    return `origin/${baseBranch}`;
  }
  return null;
}

/**
 * Inspect the checkout without changing it.
 *
 * Never throws: a missing repository, a missing base branch and an unfetchable
 * remote are all reportable states, and a diagnostic that dies on one of them
 * tells the operator nothing about the other five sections of the report.
 */
export function inspectRepoStatus(options: RepoStatusOptions): RepoStatus {
  const { baseBranch } = options;

  const { head, fatal } = readHead();
  if (fatal !== null) return notARepo(baseBranch, fatal);

  // `symbolic-ref` is the detached-HEAD test: `rev-parse --abbrev-ref HEAD`
  // answers the literal string "HEAD" when detached, which is indistinguishable
  // from a branch actually called HEAD.
  const symbolic = git(["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const branch = symbolic.status === 0 ? symbolic.stdout.trim() : null;

  const dirtyPaths = readDirtyPaths();
  const baseLocal =
    git(["rev-parse", "--verify", "--quiet", `refs/heads/${baseBranch}`]).status === 0;

  const { refreshed, fetchError } = options.fetch
    ? refreshBase(baseBranch)
    : { refreshed: false, fetchError: null };

  const upstream = resolveUpstream(baseBranch, baseLocal);
  const counts = baseLocal && upstream !== null ? divergence(upstream, baseBranch) : null;

  return {
    branch,
    head,
    dirtyPaths,
    baseBranch,
    baseLocal,
    upstream,
    ahead: counts?.ahead ?? null,
    behind: counts?.behind ?? null,
    refreshed,
    fetchError,
    error: null,
  };
}
