import { createInterface } from "node:readline";
import { Command } from "commander";
import { isAzdo, isExplicitGitHub } from "../remote/backend.js";
import { assertAzdoReady, resolveAzdoUser } from "../remote/azdoPrerequisites.js";
import { listWorkItems } from "../remote/azdoWorkItems.js";
import { selectWriteService, type RemoteWriteService } from "../remote/writeService.js";
import {
  readConfig, DEFAULT_CLAUDE_SYSTEM_PROMPT, azdoPrInstructions,
  type AutomataConfig,
} from "../config/configStore.js";
import { listIssues, type GitHubIssue } from "../config/githubService.js";
import { invokeClaudeCode } from "../claude/claudeService.js";
import { invokeCodexCode } from "../codex/codexService.js";
import { resolveEffortOption } from "../cli/spawnUtils.js";

function writeOverflowHint(output: NodeJS.WriteStream, issues: GitHubIssue[], limit: number): void {
  if (issues.length === limit) {
    output.write(`(Showing first ${limit} matching issues — there may be more. Use --limit to fetch more.)\n`);
  }
}

function writeIssueList(output: NodeJS.WriteStream, issues: GitHubIssue[], limit: number): void {
  output.write("\nAvailable issues:\n");
  for (let i = 0; i < issues.length; i++) {
    output.write(`  [${i + 1}] #${issues[i].number} - ${issues[i].title}\n`);
  }
  writeOverflowHint(output, issues, limit);
}

async function promptSelection(
  issues: GitHubIssue[],
  limit: number,
  output: NodeJS.WriteStream,
): Promise<GitHubIssue> {
  writeIssueList(output, issues, limit);

  const rl = createInterface({ input: process.stdin, output });
  const answer = await new Promise<string>(resolve =>
    rl.question(`\nSelect issue (1-${issues.length}): `, resolve)
  );
  rl.close();

  const n = Number.parseInt(answer.trim(), 10);
  if (Number.isNaN(n) || n < 1 || n > issues.length) {
    process.stderr.write(`Error: Invalid selection "${answer.trim()}". Enter a number between 1 and ${issues.length}.\n`);
    process.exit(1);
  }
  return issues[n - 1];
}

function validateConfig(config: AutomataConfig): void {
  if (!isExplicitGitHub(config) && !isAzdo(config)) {
    process.stderr.write("Error: No remote type configured. Run `automata config` to set one.\n");
    process.exit(1);
  }

  if (!config.issueDiscoveryTechnique) {
    process.stderr.write(
      "Error: No issue discovery technique configured. Run `automata config` to set one.\n",
    );
    process.exit(1);
  }

  if (!config.issueDiscoveryValue) {
    process.stderr.write(
      "Error: No issue discovery value configured. Run `automata config` to set one.\n",
    );
    process.exit(1);
  }
}

async function resolveIssue(
  issues: GitHubIssue[],
  options: { json?: boolean; queryOnly?: boolean; takeFirst?: boolean },
  limit: number,
): Promise<GitHubIssue> {
  const selectionOutput = options.json ? process.stderr : process.stdout;

  if (issues.length === 0) {
    process.stdout.write("No issues found matching the configured filter.\n");
    process.exit(0);
  }

  if (issues.length > 1 && options.queryOnly) {
    writeIssueList(selectionOutput, issues, limit);
    process.exit(0);
  }

  let issue: GitHubIssue;
  if (issues.length === 1) {
    issue = issues[0];
    selectionOutput.write(`Issue:  #${issue.number}\nTitle:  ${issue.title}\n`);
  } else if (options.takeFirst) {
    issue = issues[0];
    selectionOutput.write(`Selecting issue #${issue.number}: ${issue.title}\n`);
  } else {
    issue = await promptSelection(issues, limit, selectionOutput);
    selectionOutput.write(`\nIssue:  #${issue.number}\nTitle:  ${issue.title}\n`);
  }
  return issue;
}

export const implementNextCommand = new Command("implement-next")
  .description("Find the next open GitHub issue (or Azure DevOps work item) matching the configured filter, claim it, and invoke the AI code assistant (Claude or Codex)")
  .option("--json", "Output issue details as JSON")
  .option("--no-claude", "Skip all AI invocation (Claude or Codex) after claiming the issue")
  .option("--with <executor>", "Executor to use: claude or codex", "claude")
  .option("--query-only", "Print issue content and exit without claiming or invoking any AI tools")
  .option("--yolo",       "Launch with --dangerously-skip-permissions (Claude) or --dangerously-bypass-approvals-and-sandbox (Codex)")
  .option("--silent",     "Suppress step-by-step Claude output; show only the final summary")
  .option("--model <string>", "Model identifier to pass to the executor")
  .option("--effort <level>", "Reasoning effort to pass to the executor")
  .option("--take-first", "When multiple issues match, pick the first without prompting")
  .option("--limit <n>",  "Max issues to fetch and display (default: 10)", "10")
  .option("--ask-copilot-review", "Request a Copilot code review on the PR after AI invocation finishes")
  .action(async (options: {
    json?: boolean;
    claude: boolean;
    with: string;
    queryOnly?: boolean;
    yolo?: boolean;
    silent?: boolean;
    model?: string;
    effort?: string;
    takeFirst?: boolean;
    limit: string;
    askCopilotReview?: boolean;
  }) => {
    const config = readConfig();
    validateConfig(config);

    const limit = Number.parseInt(options.limit, 10);
    if (Number.isNaN(limit) || limit <= 0) {
      process.stderr.write(`Error: --limit must be a positive integer (got "${options.limit}").\n`);
      process.exit(1);
    }

    const issues = discoverIssues(config, limit);

    const issue = await resolveIssue(issues, options, limit);

    if (options.json) {
      process.stdout.write(JSON.stringify({ number: issue.number, title: issue.title, body: issue.body, url: issue.url }, null, 2) + "\n");
    } else {
      process.stdout.write(`URL:    ${issue.url}\n\n${issue.body}\n`);
    }

    if (options.queryOnly) {
      process.exit(0);
    }

    const executor = options.claude === false ? undefined : resolveExecutor(options.with);

    const remote = selectWriteService(config);
    const commentRef = claimIssue(remote, config, issue.number);

    const effort = resolveEffortOption(options.effort);

    if (options.claude !== false) {
      const prompt = buildPrompt(config, issue);
      if (executor === "codex") {
        if (options.silent) {
          process.stderr.write("Warning: --silent is only supported with Claude and has no effect when used with Codex.\n");
        }
        invokeCodexCode(prompt, { yolo: options.yolo, model: options.model, effort });
      } else {
        await invokeClaudeCode(prompt, {
          yolo: options.yolo,
          verbose: !options.silent,
          model: options.model,
          effort,
        });
      }
    }

    // ── Post-claim: link PR to issue ───────────────────────────────────────
    linkPrToIssue(remote, issue.number, commentRef, options.askCopilotReview === true, config.agentUser);
  });

function discoverIssues(config: AutomataConfig, limit: number): GitHubIssue[] {
  try {
    if (!isAzdo(config)) return listIssues(config.issueDiscoveryTechnique!, config.issueDiscoveryValue!, limit);
    assertAzdoReady();
    return listWorkItems(config.issueDiscoveryTechnique!, config.issueDiscoveryValue!, limit);
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    return process.exit(1);
  }
}

function buildPrompt(config: AutomataConfig, issue: GitHubIssue): string {
  const systemPrompt = config.claudeSystemPrompt ?? DEFAULT_CLAUDE_SYSTEM_PROMPT;
  if (!isAzdo(config)) return `Resolving issue #${issue.number}:\n\n${systemPrompt}\n\n${issue.body}`;
  return `Resolving work item #${issue.number}:\n\n${systemPrompt}\n\n${azdoPrInstructions(issue.number)}\n\n${issue.body}`;
}

function claimIssue(remote: RemoteWriteService, config: AutomataConfig, issueNumber: number): string | undefined {
  try {
    if (isAzdo(config)) remote.assignIssue(issueNumber, (config.agentUser ?? "").trim() || resolveAzdoUser());
    return remote.postIssueComment(issueNumber, "working");
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    return process.exit(1);
  }
}

function resolveExecutor(requested: string): "claude" | "codex" {
  const executor = requested.toLowerCase();
  if (executor !== "claude" && executor !== "codex") {
    process.stderr.write(`Error: --with must be 'claude' or 'codex', got '${requested}'.\n`);
    process.exit(1);
  }
  return executor;
}

// Every step here is best-effort: the work itself is already done, so a failure
// to annotate the pull request is reported and then ignored.
function warnOnFailure(what: string, action: () => void): void {
  try {
    action();
  } catch (err) {
    process.stderr.write(`Warning: could not ${what}: ${(err as Error).message}\n`);
  }
}

function linkPrToIssue(
  remote: RemoteWriteService,
  issueNumber: number,
  commentRef: string | undefined,
  askReview: boolean,
  agentUser: string | undefined,
): void {
  let pr: ReturnType<RemoteWriteService["getCurrentBranchPr"]>;
  try {
    pr = remote.getCurrentBranchPr();
  } catch (err) {
    process.stderr.write(`Warning: could not detect current branch PR: ${(err as Error).message}\n`);
    return;
  }
  if (!pr) return;

  if (commentRef) {
    warnOnFailure("update issue comment", () => {
      remote.editIssueComment(issueNumber, commentRef, `Working on this in PR #${pr.number} — ${pr.url}`);
    });
  }
  warnOnFailure(`link PR to #${String(issueNumber)}`, () => {
    remote.linkPrToIssue(pr.number, issueNumber);
  });
  // Only when nobody is assigned. `agentUser` is optional for this command —
  // unlike `do-work`, which refuses to run without it — so `@me` stands in: the
  // person running `implement-next` is the identity doing the work, and `gh`
  // resolves `@me` to the authenticated account without an extra lookup.
  // Azure DevOps pull requests have no assignee, so its `assignPr` does nothing.
  if (pr.assignees.length === 0) {
    const claimant = (agentUser ?? "").trim() || "@me";
    warnOnFailure(`assign PR #${String(pr.number)} to ${claimant}`, () => {
      remote.assignPr(pr.number, claimant);
    });
  }
  if (askReview) {
    warnOnFailure("request review", () => {
      remote.requestReview(pr.number, agentUser?.trim() || undefined);
    });
  }
}
