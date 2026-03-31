import { Command } from "commander";
import { readConfig } from "../config/configStore.js";
import { listIssues, postComment, type GitHubIssue } from "../config/githubService.js";
import { invokeClaudeCode, resolveModelOption } from "../claude/claudeService.js";

export const implementNextCommand = new Command("implement-next")
  .description("Find the next open GitHub issue matching the configured filter, claim it, and invoke Claude Code")
  .option("--json", "Output issue details as JSON")
  .option("--no-claude", "Skip Claude Code invocation after claiming the issue")
  .option("--query-only", "Print issue content and exit without claiming or invoking Claude")
  .option("--yolo",    "Launch Claude Code with --dangerously-skip-permissions")
  .option("--verbose", "Show step-by-step progress summary and final result")
  .option("--opus",    "Use claude-opus-4-6")
  .option("--sonnet",  "Use claude-sonnet-4-6")
  .option("--haiku",   "Use claude-haiku-4-5-20251001")
  .action(async (options: { json?: boolean; claude: boolean; queryOnly?: boolean; yolo?: boolean; verbose?: boolean; opus?: boolean; sonnet?: boolean; haiku?: boolean }) => {
    const config = readConfig();

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

    let issue: GitHubIssue | null;
    try {
      issue = listIssues(config.issueDiscoveryTechnique, config.issueDiscoveryValue);
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(1);
    }

    if (issue === null) {
      process.stdout.write("No issues found matching the configured filter.\n");
      process.exit(0);
    }

    if (options.json) {
      process.stdout.write(JSON.stringify({ number: issue.number, title: issue.title, body: issue.body, url: issue.url }, null, 2) + "\n");
    } else {
      process.stdout.write(`Issue:  #${issue.number}\nTitle:  ${issue.title}\nURL:    ${issue.url}\n\n${issue.body}\n`);
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
      const prompt = config.claudeSystemPrompt ? `${config.claudeSystemPrompt}\n\n${issue.body}` : issue.body;
      const model = resolveModelOption(options);
      await invokeClaudeCode(prompt, { yolo: options.yolo, verbose: options.verbose, model });
    }
  });
