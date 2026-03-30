import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { readConfig } from "../config/configStore.js";
import { listIssues, postComment, type GitHubIssue } from "../config/githubService.js";

function invokeClaudeCode(issue: GitHubIssue, systemPrompt: string | undefined): void {
  const prompt = systemPrompt ? `${systemPrompt}\n\n${issue.body}` : issue.body;
  const result = spawnSync("claude", ["-p", prompt], { encoding: "utf8", stdio: "inherit" });
  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      process.stderr.write("Error: `claude` CLI is not installed or not on PATH.\n");
      process.exit(1);
    }
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.stderr.write(`Error: Claude Code exited with code ${result.status ?? "unknown"}.\n`);
    process.exit(result.status ?? 1);
  }
}

export const getReadyCommand = new Command("get-ready")
  .description("Find the next open GitHub issue matching the configured filter, claim it, and invoke Claude Code")
  .option("--json", "Output issue details as JSON")
  .option("--no-claude", "Skip Claude Code invocation after claiming the issue")
  .action((options: { json?: boolean; claude: boolean }) => {
    const config = readConfig();

    if (config.remoteType !== "gh") {
      process.stderr.write("Error: get-ready is only available for GitHub (gh) mode.\n");
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

    try {
      postComment(issue.number, "working");
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(1);
    }

    if (options.claude !== false) {
      invokeClaudeCode(issue, config.claudeSystemPrompt);
    }
  });
