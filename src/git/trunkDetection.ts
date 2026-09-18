/**
 * Pure helpers for working out which branch a remote treats as its trunk.
 *
 * Every function here is a string transformation, so the interesting cases — a
 * tab-separated `ls-remote --symref` line, an absent `origin/HEAD` — are
 * testable without running `git`. The commands themselves live in
 * `gitService.ts`, which owns the `spawnSync` runner.
 */

/** How a trunk name was arrived at, reported to the operator. */
export type TrunkSource = "config" | "origin-head" | "ls-remote" | "probe";

/**
 * Names probed against the remote when neither `origin/HEAD` nor the remote's
 * advertised symref answers. Ordered: a repository that still has both branches
 * is far more likely to release from `main`.
 */
export const TRUNK_CANDIDATES: readonly string[] = ["main", "master"];

/** The config key an operator sets to skip detection entirely. */
export const TRUNK_BRANCH_CONFIG_KEY = "git.trunkBranch";

const ORIGIN_HEAD_PREFIX = "refs/remotes/origin/";
const SYMREF_PREFIX = "ref: refs/heads/";

/**
 * `refs/remotes/origin/main` → `main`.
 *
 * A clone made with `--single-branch` never writes `refs/remotes/origin/HEAD`,
 * so empty output is the normal "ask someone else" answer rather than an error.
 */
export function parseOriginHeadRef(stdout: string): string | null {
  const ref = stdout.trim();
  if (!ref.startsWith(ORIGIN_HEAD_PREFIX)) return null;
  const branch = ref.slice(ORIGIN_HEAD_PREFIX.length);
  return branch.length > 0 ? branch : null;
}

/**
 * The first line of `git ls-remote --symref origin HEAD` is
 * `ref: refs/heads/main\tHEAD`; the second is the sha. Splitting on whitespace
 * rather than a literal tab keeps this honest about a remote that pads
 * differently.
 */
export function parseLsRemoteSymref(stdout: string): string | null {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(SYMREF_PREFIX)) continue;
    const branch = trimmed.slice(SYMREF_PREFIX.length).split(/\s+/)[0];
    if (branch.length > 0) return branch;
  }
  return null;
}

/** Human-readable provenance, printed next to the resolved name. */
export function describeTrunkSource(source: TrunkSource, branch: string): string {
  switch (source) {
    case "config":
      return `configured as ${TRUNK_BRANCH_CONFIG_KEY}`;
    case "origin-head":
      return "from origin/HEAD";
    case "ls-remote":
      return "from the remote's advertised HEAD";
    case "probe":
      return `probed as origin/${branch}`;
  }
}

/**
 * The failure message. It names every probe that was tried, because "could not
 * determine the trunk" without that list gives the operator nowhere to start.
 */
export function unresolvedTrunkMessage(attempted: readonly string[]): string {
  return (
    "Could not determine the trunk branch of 'origin'.\n" +
    `Tried: ${attempted.join(", ")}.\n` +
    `Set it explicitly with: automata config set git-trunk-branch <branch>`
  );
}
