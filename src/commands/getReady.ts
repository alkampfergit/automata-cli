import { createInterface } from "node:readline";
import { Command } from "commander";
import { readConfig, DEFAULT_CLAUDE_SYSTEM_PROMPT } from "../config/configStore.js";
import { listIssues, postComment, type GitHubIssue } from "../config/githubService.js";
import { invokeClaudeCode, resolveModelOption } from "../claude/claudeService.js";
import { invokeCodexCode } from "../codex/codexService.js";

async function promptSelection(issues: GitHubIssue[], limit: number): Promise<GitHubIssue> {
  process.stdout.write("\nAvailable issues:\n");
  for (let i = 0; i < issues.length; i++) {
    process.stdout.write(`  [${i + 1}] #${issues[i].number} - ${issues[i].title}\n`);
  }
  if (issues.length === limit) {
    process.stdout.write(`(Showing first ${limit} ready issues — there may be more. Use --limit to fetch more.)\n`);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
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

function validateConfig(config: ReturnType<typeof readConfig>): void {
  if (config.remoteType !== "gh") {
    process.stderr.write(
      "Error: implement-next is not supported in Azure DevOps mode. Work item discovery is not available in azdo-cli. See docs/azdo-gap.md for details.\n",
    );
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
  options: { queryOnly?: boolean; takeFirst?: boolean },
  limit: number,
): Promise<GitHubIssue> {
  if (issues.length === 0) {
    process.stdout.write("No issues found matching the configured filter.\n");
    process.exit(0);
  }

  if (issues.length > 1 && options.queryOnly) {
    process.stdout.write("\nAvailable issues:\n");
    for (let i = 0; i < issues.length; i++) {
      process.stdout.write(`  [${i + 1}] #${issues[i].number} - ${issues[i].title}\n`);
    }
    if (issues.length === limit) {
      process.stdout.write(`(Showing first ${limit} ready issues — there may be more. Use --limit to fetch more.)\n`);
    }
    process.exit(0);
  }

  let issue: GitHubIssue;
  if (issues.length === 1) {
    issue = issues[0];
    process.stdout.write(`Issue:  #${issue.number}\nTitle:  ${issue.title}\n`);
  } else if (options.takeFirst) {
    issue = issues[0];
    process.stdout.write(`Selecting issue #${issue.number}: ${issue.title}\n`);
  } else {
    issue = await promptSelection(issues, limit);
    process.stdout.write(`\nIssue:  #${issue.number}\nTitle:  ${issue.title}\n`);
  }
  return issue;
}

export const implementNextCommand = new Command("implement-next")
  .description("Find the next open GitHub issue matching the configured filter, claim it, and invoke the AI code assistant (Claude or Codex)")
  .option("--json", "Output issue details as JSON")
  .option("--no-claude", "Skip all AI invocation (Claude or Codex) after claiming the issue")
  .option("--codex",      "Use Codex CLI instead of Claude Code")
  .option("--query-only", "Print issue content and exit without claiming or invoking any AI tools")
  .option("--yolo",       "Launch with --dangerously-skip-permissions (Claude) or --dangerously-bypass-approvals-and-sandbox (Codex)")
  .option("--verbose",    "Show step-by-step progress summary and final result")
  .option("--opus",       "Use claude-opus-4-6")
  .option("--sonnet",     "Use claude-sonnet-4-6")
  .option("--haiku",      "Use claude-haiku-4-5-20251001")
  .option("--take-first", "When multiple issues match, pick the first without prompting")
  .option("--limit <n>",  "Max issues to fetch and display (default: 10)", "10")
  .action(async (options: {
    json?: boolean;
    claude: boolean;
    codex?: boolean;
    queryOnly?: boolean;
    yolo?: boolean;
    verbose?: boolean;
    opus?: boolean;
    sonnet?: boolean;
    haiku?: boolean;
    takeFirst?: boolean;
    limit: string;
  }) => {
    const config = readConfig();
    validateConfig(config);

    const limit = Number.parseInt(options.limit, 10);
    if (Number.isNaN(limit) || limit <= 0) {
      process.stderr.write(`Error: --limit must be a positive integer (got "${options.limit}").\n`);
      process.exit(1);
    }

    let issues: GitHubIssue[];
    try {
      issues = listIssues(config.issueDiscoveryTechnique!, config.issueDiscoveryValue!, limit);
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(1);
    }

    const issue = await resolveIssue(issues, options, limit);

    if (options.json) {
      process.stdout.write(JSON.stringify({ number: issue.number, title: issue.title, body: issue.body, url: issue.url }, null, 2) + "\n");
    } else {
      process.stdout.write(`URL:    ${issue.url}\n\n${issue.body}\n`);
    }

    if (options.queryOnly) {
      process.exit(0);
    }

    try {
      postComment(issue.number, "working");
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(1);
    }

    if (options.claude !== false) {
      const systemPrompt = config.claudeSystemPrompt ?? DEFAULT_CLAUDE_SYSTEM_PROMPT;
      const prompt = `Resolving issue #${issue.number}:\n\n${systemPrompt}\n\n${issue.body}`;
      if (options.codex) {
        await invokeCodexCode(prompt, { yolo: options.yolo, verbose: options.verbose });
      } else {
        const model = resolveModelOption(options);
        await invokeClaudeCode(prompt, { yolo: options.yolo, verbose: options.verbose, model });
      }
    }
  });
