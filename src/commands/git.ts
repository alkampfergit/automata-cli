import { Command } from "commander";
import {
  getCurrentBranch,
  getPrInfo,
  getPrComments,
  isUpstreamGone,
  hasUncommittedChanges,
  checkoutAndPull,
  deleteLocalBranch,
  fetchPrune,
  getLatestTagOnMaster,
  bumpMinorVersion,
  tagExists,
  publishRelease,
  type PrCheck,
  type PrInfo,
  type SonarFailureSummary,
  type SonarGateViolation,
  type SonarIssue,
  type SonarSecurityHotspot,
} from "../git/gitService.js";

const FAIL_CONCLUSIONS = new Set(["FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "CANCELLED"]);
const SKIP_CONCLUSIONS = new Set(["SKIPPED", "NEUTRAL"]);

function checkSymbol(check: PrCheck): string {
  if (check.status !== "COMPLETED") return "●";
  if (check.conclusion === "SUCCESS") return "✓";
  if (check.conclusion !== null && SKIP_CONCLUSIONS.has(check.conclusion)) return "○";
  if (check.conclusion !== null && FAIL_CONCLUSIONS.has(check.conclusion)) return "✗";
  return "●";
}

function formatCheckSummary(checks: PrCheck[]): string {
  const running = checks.some((c) => c.status !== "COMPLETED");
  const failed = checks.filter((c) => c.conclusion !== null && FAIL_CONCLUSIONS.has(c.conclusion));
  const errors =
    failed.length === 0
      ? "none"
      : failed.map((c) => `${c.name}: ${c.description.trim() || c.detailsUrl || "no details available"}`).join("; ");
  return `Checks Running: ${String(running)}\nCheck Errors:   ${errors}\n`;
}

function formatChecks(checks: PrCheck[]): string {
  if (checks.length === 0) return "Checks: none\n";
  const lines: string[] = ["Checks:"];
  for (const check of checks) {
    const sym = checkSymbol(check);
    const pending = check.status !== "COMPLETED" ? " (pending)" : "";
    lines.push(`  ${sym} ${check.name}${pending}`);
  }
  return lines.join("\n") + "\n";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSonarCheck(check: PrCheck): boolean {
  try {
    const hostname = new URL(check.detailsUrl).hostname;
    return hostname === "sonarcloud.io" || hostname.endsWith(".sonarcloud.io");
  } catch {
    return false;
  }
}

function formatFailedChecks(failed: PrCheck[]): string {
  const lines: string[] = ["FailedChecks:"];
  for (const check of failed) {
    lines.push(`  ✗ ${check.name}`);
    const desc = check.description.trim();
    const url = check.detailsUrl.trim();
    if (desc) lines.push(`    Details: ${desc}`);
    if (url && (isSonarCheck(check) || !desc)) lines.push(`    URL:     ${url}`);
    if (!desc && !url) lines.push(`    Details: (no details available)`);
  }
  return lines.join("\n") + "\n";
}

function formatGateViolation(violation: SonarGateViolation): string {
  const parts = [sanitizeText(violation.metricKey)];
  if (violation.actualValue) parts.push(`actual ${sanitizeText(violation.actualValue)}`);
  if (violation.comparator && violation.errorThreshold) {
    parts.push(`${sanitizeText(violation.comparator)} ${sanitizeText(violation.errorThreshold)}`);
  } else if (violation.errorThreshold) {
    parts.push(`threshold ${sanitizeText(violation.errorThreshold)}`);
  }
  return parts.join(" | ");
}

function formatLocation(path: string | undefined, line: number | null | undefined): string | undefined {
  if (!path) return undefined;
  const safePath = sanitizeText(path);
  if (!line) return safePath;
  return `${safePath}:${String(line)}`;
}

function formatRuleWithName(rule: string, ruleName: string | undefined): string {
  const safeRule = sanitizeText(rule);
  if (!ruleName) return safeRule;
  return `${safeRule} (${sanitizeText(ruleName)})`;
}

function formatSonarIssue(issue: SonarIssue): string[] {
  const lines = [`    - ${sanitizeText(issue.message)}`];
  const location = formatLocation(issue.path, issue.line);
  if (location) lines.push(`      Location: ${location}`);
  if (issue.severity || issue.type) {
    const labels = [issue.severity, issue.type].filter((label): label is string => Boolean(label)).map(sanitizeText).join(" / ");
    lines.push(`      Classification: ${labels}`);
  }
  if (issue.rule) lines.push(`      Rule: ${sanitizeText(issue.rule)}`);
  if (issue.explanation) lines.push(`      Explanation: ${sanitizeText(issue.explanation)}`);
  return lines;
}

function formatSonarHotspot(hotspot: SonarSecurityHotspot): string[] {
  const lines = [`    - ${sanitizeText(hotspot.message)}`];
  const location = formatLocation(hotspot.path, hotspot.line);
  if (location) lines.push(`      Location: ${location}`);
  if (hotspot.status) lines.push(`      Status: ${sanitizeText(hotspot.status)}`);
  if (hotspot.vulnerabilityProbability || hotspot.securityCategory) {
    const labels = [hotspot.vulnerabilityProbability, hotspot.securityCategory]
      .filter((label): label is string => Boolean(label))
      .map(sanitizeText)
      .join(" / ");
    lines.push(`      Classification: ${labels}`);
  }
  if (hotspot.rule) {
    lines.push(`      Rule: ${formatRuleWithName(hotspot.rule, hotspot.ruleName)}`);
  }
  if (hotspot.riskDescription) lines.push(`      Risk: ${sanitizeText(hotspot.riskDescription)}`);
  if (hotspot.vulnerabilityDescription) lines.push(`      Review: ${sanitizeText(hotspot.vulnerabilityDescription)}`);
  if (hotspot.fixRecommendations) lines.push(`      Fix: ${sanitizeText(hotspot.fixRecommendations)}`);
  return lines;
}

function appendGateViolations(lines: string[], gateViolations: SonarGateViolation[]): void {
  if (gateViolations.length === 0) return;
  lines.push("  Gate Violations:");
  for (const violation of gateViolations) {
    lines.push(`    - ${formatGateViolation(violation)}`);
  }
}

function appendSonarIssues(lines: string[], issues: SonarIssue[]): void {
  if (issues.length === 0) return;
  lines.push("  Issues:");
  for (const issue of issues) {
    lines.push(...formatSonarIssue(issue));
  }
}

function appendSecurityHotspots(lines: string[], securityHotspots: SonarSecurityHotspot[]): void {
  if (securityHotspots.length === 0) return;
  lines.push("  Security Hotspots:");
  for (const hotspot of securityHotspots) {
    lines.push(...formatSonarHotspot(hotspot));
  }
}

function hasSonarFailureDetails(sonarFailures: SonarFailureSummary): boolean {
  return (
    Boolean(sonarFailures.qualityGateStatus) ||
    sonarFailures.gateViolations.length > 0 ||
    sonarFailures.issues.length > 0 ||
    sonarFailures.securityHotspots.length > 0
  );
}

function formatSonarFailures(sonarFailures: SonarFailureSummary, sonarcloudUrl: string | undefined): string {
  const lines: string[] = ["Sonar Failures:"];

  if (sonarFailures.status === "private") {
    lines.push(`  Note: ${sanitizeText(sonarFailures.privateMessage ?? "SonarCloud project is private.")}`);
    return lines.join("\n") + "\n";
  }

  if (sonarFailures.status === "unavailable") {
    lines.push(`  Note: ${sanitizeText(sonarFailures.unavailableMessage ?? "SonarCloud failure details are unavailable.")}`);
    if (sonarcloudUrl) lines.push(`  URL:  ${sonarcloudUrl}`);
    return lines.join("\n") + "\n";
  }

  if (sonarFailures.qualityGateStatus) {
    lines.push(`  Quality Gate: ${sanitizeText(sonarFailures.qualityGateStatus)}`);
  }

  appendGateViolations(lines, sonarFailures.gateViolations);
  appendSonarIssues(lines, sonarFailures.issues);
  appendSecurityHotspots(lines, sonarFailures.securityHotspots);

  if (!hasSonarFailureDetails(sonarFailures)) {
    lines.push("  Note: SonarCloud reported a failure but returned no violation, issue, or hotspot details.");
    if (sonarcloudUrl) lines.push(`  URL:  ${sonarcloudUrl}`);
  }

  return lines.join("\n") + "\n";
}

const POLL_INTERVAL_MS = 10_000;

const getPrInfoCmd = new Command("get-pr-info")
  .description("Show pull request info for the current branch")
  .option("--json", "Output as JSON")
  .option("--wait-finish-checks", "Poll until all checks complete, then print the normal get-pr-info output")
  .addHelpText(
    "after",
    `
Check status symbols:
  ✓  Passed        (conclusion: SUCCESS)
  ✗  Failed        (conclusion: FAILURE / TIMED_OUT / ACTION_REQUIRED / CANCELLED)
  ●  Pending       (status: QUEUED or IN_PROGRESS)
  ○  Skipped       (conclusion: SKIPPED or NEUTRAL)

When checks fail, details are printed in a trailing FailedChecks section.
See docs/git.md for full output reference.`,
  )
  .action(async (options: { json?: boolean; waitFinishChecks?: boolean }) => {
    let branch: string;
    let pr: PrInfo | null = null;
    try {
      branch = getCurrentBranch();
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(1);
    }

    if (options.waitFinishChecks) {
      while (true) {
        try {
          pr = await getPrInfo(branch);
        } catch (err) {
          process.stderr.write(`Error: ${(err as Error).message}\n`);
          process.exit(1);
        }
        if (pr === null) {
          break;
        }
        const running = pr.checks.filter((c) => c.status !== "COMPLETED");
        if (running.length === 0) break;
        process.stdout.write(`Waiting for ${running.length} check(s) to complete...\n`);
        await sleep(POLL_INTERVAL_MS);
      }
    } else {
      try {
        pr = await getPrInfo(branch);
      } catch (err) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exit(1);
      }
    }

    if (pr === null) {
      process.stdout.write(`No pull request found for branch: ${branch}\n`);
      process.exit(0);
    }

    if (options.json) {
      process.stdout.write(JSON.stringify(pr, null, 2) + "\n");
    } else {
      const failed = pr.checks.filter((c) => c.conclusion !== null && FAIL_CONCLUSIONS.has(c.conclusion));
      process.stdout.write(`PR:    #${pr.number}\nTitle: ${pr.title}\nState: ${pr.state}\nURL:   ${pr.url}\n`);
      if (pr.sonarcloudUrl !== undefined) {
        process.stdout.write(`Sonar: ${pr.sonarcloudUrl}\n`);
        const issueStr = pr.sonarNewIssues === null || pr.sonarNewIssues === undefined
          ? "unavailable"
          : String(pr.sonarNewIssues);
        process.stdout.write(`Sonar New Issues: ${issueStr}\n`);
      }
      process.stdout.write(formatCheckSummary(pr.checks));
      process.stdout.write(formatChecks(pr.checks));
      if (failed.length > 0) {
        process.stdout.write(formatFailedChecks(failed));
      }
      if (pr.sonarFailures !== undefined) {
        process.stdout.write(formatSonarFailures(pr.sonarFailures, pr.sonarcloudUrl));
      }
    }
  });

// Strip ANSI/CSI escape sequences and non-printable control characters from
// untrusted text before writing to the terminal.
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_RE = new RegExp("\x1b(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])", "g");
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = new RegExp("[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "g");

function sanitizeText(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, "").replace(CONTROL_CHARS_RE, "");
}

const getPrCommentsCmd = new Command("get-pr-comments")
  .description("List open (unresolved) review comments on the pull request for the current branch (GitHub only)")
  .option("--json", "Output as JSON array")
  .addHelpText(
    "after",
    `
Only GitHub (remoteType: gh) is supported. Azure DevOps is not supported.
See docs/azdo-gap.md for details.`,
  )
  .action((options: { json?: boolean }) => {
    let branch: string;
    try {
      branch = getCurrentBranch();
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(1);
    }

    let comments;
    try {
      comments = getPrComments(branch);
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(1);
    }

    if (comments === "unsupported") {
      process.stderr.write(
        `Error: get-pr-comments is not supported for Azure DevOps. See docs/azdo-gap.md for details.\n`,
      );
      process.exit(1);
    }

    if (comments === null) {
      process.stderr.write(`Error: No pull request found for branch: ${branch}\n`);
      process.exit(1);
    }

    if (options.json) {
      process.stdout.write(JSON.stringify(comments, null, 2) + "\n");
      return;
    }

    if (comments.length === 0) {
      process.stdout.write(`No open comments.\n`);
      return;
    }

    const lines: string[] = [];
    for (const c of comments) {
      const loc = c.line !== null ? `${c.path}:${String(c.line)}` : `${c.path}:(file)`;
      const safeBody = sanitizeText(c.body);
      const safeAuthor = sanitizeText(c.author);
      lines.push(`[${safeAuthor}] on ${loc}\n${safeBody}`);
    }
    process.stdout.write(lines.join("\n\n") + "\n");
  });

const finishFeatureCmd = new Command("finish-feature")
  .description("Clean up a merged feature branch: checkout develop, pull, and delete local branch")
  .action(async () => {
    let branch: string;
    try {
      branch = getCurrentBranch();
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(1);
    }

    if (branch === "develop") {
      process.stderr.write("Error: finish-feature cannot be run from the develop branch.\n");
      process.exit(1);
    }

    if (hasUncommittedChanges()) {
      process.stderr.write(
        "Error: You have uncommitted changes. Commit or stash them before running finish-feature.\n",
      );
      process.exit(1);
    }

    let pr;
    try {
      pr = await getPrInfo(branch);
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(1);
    }

    if (pr === null) {
      process.stderr.write(`Error: No pull request found for branch: ${branch}\n`);
      process.exit(1);
    }

    if (pr.state === "OPEN") {
      process.stderr.write(`Error: Pull request #${pr.number} is still open. Merge it before finishing the feature.\n`);
      process.exit(1);
    }

    if (pr.state === "CLOSED") {
      process.stderr.write(
        `Error: Pull request #${pr.number} was closed without merging. finish-feature only proceeds for merged PRs.\n`,
      );
      process.exit(1);
    }

    if (!isUpstreamGone(branch)) {
      process.stderr.write(
        `Error: Remote tracking branch 'origin/${branch}' still exists. Push or delete it remotely before finishing.\n`,
      );
      process.exit(1);
    }

    try {
      process.stdout.write(`Fetching and pruning remote refs...\n`);
      fetchPrune();
      process.stdout.write(`Checking out develop and pulling latest...\n`);
      checkoutAndPull("develop");
      process.stdout.write(`Deleting local branch: ${branch}\n`);
      deleteLocalBranch(branch);
      process.stdout.write(`Done. Branch '${branch}' has been removed.\n`);
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(1);
    }
  });

const SEMVER_ARG_RE = /^\d+\.\d+\.\d+$/;

const publishReleaseCmd = new Command("publish-release")
  .description("Execute the full GitFlow release sequence and push to origin")
  .argument("[version]", "Release version in X.Y.Z format (auto-detected from master tag if omitted)")
  .option("--dry-run", "Print git commands without executing them")
  .addHelpText(
    "after",
    `
Release sequence:
  1. git checkout -b release/<version>
  2. git checkout master && git merge --no-ff release/<version>
  3. git tag <version>
  4. git checkout develop && git merge --no-ff release/<version>
  5. git branch -d release/<version>
  6. git push origin develop master <version>

When [version] is omitted the latest semver tag on master is detected and the
minor segment is incremented (e.g. 1.2.0 → 1.3.0).`,
  )
  .action((version: string | undefined, options: { dryRun?: boolean }) => {
    const dryRun = options.dryRun ?? false;

    // Precondition: must be on develop
    let branch: string;
    try {
      branch = getCurrentBranch();
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(1);
    }
    if (branch !== "develop") {
      process.stderr.write(
        `Error: publish-release must be run from the 'develop' branch (currently on '${branch}').\n`,
      );
      process.exit(1);
    }

    // Precondition: clean working tree
    if (hasUncommittedChanges()) {
      process.stderr.write("Error: You have uncommitted changes. Commit or stash them before publishing a release.\n");
      process.exit(1);
    }

    // Resolve version
    let resolvedVersion: string;
    if (version !== undefined) {
      if (!SEMVER_ARG_RE.test(version)) {
        process.stderr.write(`Error: Version '${version}' is not valid semver. Use X.Y.Z format (e.g. 1.2.0).\n`);
        process.exit(1);
      }
      resolvedVersion = version;
    } else {
      const latest = getLatestTagOnMaster();
      if (latest === null) {
        process.stderr.write(
          "Error: No semver tag found on master. Pass a version explicitly: automata git publish-release <X.Y.Z>\n",
        );
        process.exit(1);
      }
      resolvedVersion = bumpMinorVersion(latest);
      process.stdout.write(`Auto-detected version: ${latest} → ${resolvedVersion}\n`);
    }

    // Precondition: tag must not already exist
    if (tagExists(resolvedVersion)) {
      process.stderr.write(`Error: Tag '${resolvedVersion}' already exists.\n`);
      process.exit(1);
    }

    if (dryRun) {
      process.stdout.write(`Dry-run: release ${resolvedVersion}\n`);
    } else {
      process.stdout.write(`Publishing release ${resolvedVersion}...\n`);
    }

    try {
      publishRelease(resolvedVersion, dryRun);
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(1);
    }

    if (!dryRun) {
      process.stdout.write(`Release ${resolvedVersion} published successfully.\n`);
    }
  });

export const gitCommand = new Command("git")
  .description("Git workflow commands (some require gh CLI)")
  .addCommand(getPrInfoCmd)
  .addCommand(getPrCommentsCmd)
  .addCommand(finishFeatureCmd)
  .addCommand(publishReleaseCmd);
