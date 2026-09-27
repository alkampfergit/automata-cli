/**
 * Pure helpers for the two release procedures `publish-release` knows.
 *
 * The step lists live here as data so both flows are testable without running
 * `git`, and so a dry run prints exactly the list a real run executes. The
 * runner, and every probe that decides which flow applies, stay in
 * `gitService.ts`, which owns the `spawnSync` wrapper.
 */

/** `gitflow` releases from `develop` through `release/<version>`; `trunk` tags the trunk directly. */
export type ReleaseFlow = "gitflow" | "trunk";

export const RELEASE_FLOWS: readonly ReleaseFlow[] = ["gitflow", "trunk"];

/** The config key an operator sets to skip detection. */
export const RELEASE_FLOW_CONFIG_KEY = "git.releaseFlow";

/** How the flow was arrived at, reported to the operator. */
export type ReleaseFlowSource = "config" | "develop-present" | "develop-absent";

export function isReleaseFlow(value: unknown): value is ReleaseFlow {
  return typeof value === "string" && (RELEASE_FLOWS as readonly string[]).includes(value);
}

/** Human-readable provenance, printed next to the resolved flow. */
export function describeReleaseFlowSource(source: ReleaseFlowSource): string {
  switch (source) {
    case "config":
      return `configured as ${RELEASE_FLOW_CONFIG_KEY}`;
    case "develop-present":
      return "detected: origin/develop exists";
    case "develop-absent":
      return "detected: origin/develop does not exist";
  }
}

export function invalidReleaseFlowMessage(value: unknown): string {
  return (
    `Invalid ${RELEASE_FLOW_CONFIG_KEY} ${JSON.stringify(value)} in .automata/config.json; ` +
    `expected one of: ${RELEASE_FLOWS.join(", ")}.\n` +
    "Fix it with: automata config set git-release-flow <gitflow|trunk>"
  );
}

export interface ReleaseStep {
  args: string[];
  desc: string;
}

/**
 * The git commands a release runs, in order.
 *
 * The trunk flow always makes an empty release commit: the branch-push CI only
 * fires when the trunk ref moves, which GitFlow gets for free from its
 * `merge --no-ff`. The push is `--atomic` so the tag can never reach origin
 * without the branch it points into — CI reads the tag on HEAD of that push.
 *
 * `trunkIsLocal` only matters to gitflow, which has to check the trunk out. The
 * `-b <trunk> origin/<trunk>` form deliberately omits `--track`: in a clone made
 * with `--single-branch`, git refuses to set an upstream from a ref its
 * configured refspec does not cover.
 */
export function planRelease(
  flow: ReleaseFlow,
  version: string,
  trunk: string,
  trunkIsLocal: boolean,
): ReleaseStep[] {
  if (flow === "trunk") {
    const message = `chore(release): ${version}`;
    return [
      { args: ["commit", "--allow-empty", "-m", message], desc: `git commit --allow-empty -m "${message}"` },
      { args: ["tag", version], desc: `git tag ${version}` },
      {
        args: ["push", "--atomic", "origin", trunk, version],
        desc: `git push --atomic origin ${trunk} ${version}`,
      },
    ];
  }

  const releaseBranch = `release/${version}`;
  const checkoutTrunk = trunkIsLocal
    ? { args: ["checkout", trunk], desc: `git checkout ${trunk}` }
    : {
        args: ["checkout", "-b", trunk, `origin/${trunk}`],
        desc: `git checkout -b ${trunk} origin/${trunk}`,
      };

  return [
    { args: ["checkout", "-b", releaseBranch], desc: `git checkout -b ${releaseBranch}` },
    checkoutTrunk,
    { args: ["merge", "--no-ff", releaseBranch], desc: `git merge --no-ff ${releaseBranch}` },
    { args: ["tag", version], desc: `git tag ${version}` },
    { args: ["checkout", "develop"], desc: `git checkout develop` },
    { args: ["merge", "--no-ff", releaseBranch], desc: `git merge --no-ff ${releaseBranch}` },
    { args: ["branch", "-d", releaseBranch], desc: `git branch -d ${releaseBranch}` },
    {
      args: ["push", "origin", "develop", trunk, version],
      desc: `git push origin develop ${trunk} ${version}`,
    },
  ];
}
