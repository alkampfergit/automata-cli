import { Command } from "commander";
import { getCurrentBranch, getPrInfo, resolveCurrentBranchComments, type PrComment, type PrInfo } from "../git/gitService.js";
import {
  readConfig,
  DEFAULT_SONAR_PROMPT,
  DEFAULT_FIX_COMMENTS_PROMPT,
  DEFAULT_CHECK_ISSUE_PROMPT,
} from "../config/configStore.js";
import { getIssueConversation, postComment, type IssueConversation } from "../config/githubService.js";
import { analyzeConversation, formatConversation } from "../github/issueConversation.js";
import { invokeClaudeCode } from "../claude/claudeService.js";
import { invokeCodexCode } from "../codex/codexService.js";

const PUSH_INSTRUCTION =
  "Once all changes are complete, stage every modified file, create a single commit with a clear and descriptive commit message that summarises what was fixed, and push the branch to the remote.";

function withPush(prompt: string, push: boolean | undefined): string {
  return push ? `${prompt}\n\n${PUSH_INSTRUCTION}` : prompt;
}

function formatPrInfoContext(pr: PrInfo): string {
  return JSON.stringify(pr, null, 2);
}

function pluralSuffix(count: number): string {
  return count === 1 ? "" : "s";
}

type ExecutePromptAiOptions = {
  with: string;
  model?: string;
  silent?: boolean;
  push?: boolean;
};

type Executor = "claude" | "codex";

function addAiOptions(cmd: Command): Command {
  return cmd
    .requiredOption("--with <executor>", "Executor to use: claude or codex")
    .option("--model <string>", "Model identifier to pass to the executor")
    .option("--silent", "Suppress step-by-step Claude output; show only the final summary")
    .option("--push", "Append instruction to commit and push changes after the AI finishes")
}

function resolveExecutor(withOption: string): Executor {
  const executor = withOption.toLowerCase();
  if (executor !== "claude" && executor !== "codex") {
    process.stderr.write(`Error: --with must be 'claude' or 'codex', got '${withOption}'.\n`);
    process.exit(1);
  }
  return executor;
}

function invokeSelectedExecutor(prompt: string, executor: Executor, options: ExecutePromptAiOptions): Promise<void> | void {
  if (executor === "codex") {
    invokeCodexCode(prompt, { yolo: true, model: options.model });
    return;
  }

  return invokeClaudeCode(prompt, { yolo: true, verbose: !options.silent, model: options.model });
}

const executeSonarCmd = addAiOptions(
  new Command("sonar").description(
    "Check the current branch for a SonarCloud analysis and invoke the AI with the Sonar prompt and analysis URL",
  ),
).action(async (options: ExecutePromptAiOptions) => {
  const executor = resolveExecutor(options.with);

  let branch: string;
  try {
    branch = getCurrentBranch();
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
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

  if (!pr.sonarcloudUrl) {
    process.stderr.write(
      `Error: No SonarCloud analysis found for PR #${pr.number}. ` +
        `Ensure a SonarCloud check is configured on this repository.\n`,
    );
    process.exit(1);
  }

  const config = readConfig();
  const sonarPromptText = config.prompts?.sonar ?? DEFAULT_SONAR_PROMPT;
  const fullPrompt = withPush(
    `${sonarPromptText}\n\nSonarCloud analysis URL: ${pr.sonarcloudUrl}` +
      `\n\nCurrent PR context from automata git get-pr-info --json:\n${formatPrInfoContext(pr)}`,
    options.push,
  );

  await invokeSelectedExecutor(fullPrompt, executor, options);
});

function formatComments(comments: PrComment[]): string {
  return comments
    .map((c) => {
      const loc = c.line === null ? `${c.path}:(file)` : `${c.path}:${String(c.line)}`;
      return `[${c.author}] on ${loc}\n${c.body}`;
    })
    .join("\n\n");
}

const executeFixCommentsCmd = addAiOptions(
  new Command("fix-comments").description(
    "Fetch open review comments on the current PR and invoke the AI with the Fix-Comments prompt",
  ),
).action(async (options: ExecutePromptAiOptions) => {
  const executor = resolveExecutor(options.with);

  const result = resolveCurrentBranchComments();
  if (!result.ok) {
    if (result.kind === "error") {
      process.stderr.write(`Error: ${result.message}\n`);
      process.exit(1);
    }
    if (result.kind === "unsupported") {
      process.stderr.write(
        `Error: fix-comments is not supported for Azure DevOps. See docs/azdo-gap.md for details.\n`,
      );
      process.exit(1);
    }
    process.stderr.write(`Error: No pull request found for branch: ${result.branch}\n`);
    process.exit(1);
  }
  const { comments } = result;

  if (comments.length === 0) {
    process.stderr.write(`Error: No open review comments found on the pull request.\n`);
    process.exit(1);
  }

  process.stdout.write(`Found ${String(comments.length)} open review comment${comments.length === 1 ? "" : "s"} on PR. Invoking AI…\n`);

  const config = readConfig();
  const promptText = config.prompts?.fixComments ?? DEFAULT_FIX_COMMENTS_PROMPT;
  const fullPrompt = withPush(
    `${promptText}\n\nOpen review comments:\n\n${formatComments(comments)}`,
    options.push,
  );

  await invokeSelectedExecutor(fullPrompt, executor, options);
});

type CheckIssueOptions = ExecutePromptAiOptions & { force?: boolean };

const executeCheckIssueCmd = addAiOptions(
  new Command("check-issue")
    .description(
      "Check a GitHub issue for a new message from an allowed user since the last agent run and invoke the AI with the issue conversation",
    )
    .argument("<issue-number>", "GitHub issue number to check"),
)
  .option("--force", "Skip the new-message check and invoke the AI directly")
  .action(async (issueNumberArg: string, options: CheckIssueOptions) => {
    const executor = resolveExecutor(options.with);

    const issueNumber = Number.parseInt(issueNumberArg, 10);
    if (Number.isNaN(issueNumber) || issueNumber <= 0) {
      process.stderr.write(`Error: <issue-number> must be a positive integer (got '${issueNumberArg}').\n`);
      process.exit(1);
    }

    const config = readConfig();

    if (config.remoteType === "azdo") {
      process.stderr.write(
        "Error: check-issue is not supported for Azure DevOps. See docs/azdo-gap.md for details.\n",
      );
      process.exit(1);
    }

    const allowedUsers = (config.allowedUsers ?? []).filter((user) => user.trim().length > 0);
    if (allowedUsers.length === 0) {
      process.stderr.write(
        "Error: No allowed users configured. Run `automata config` or `automata config set allowed-users <user1,user2>` to set them.\n",
      );
      process.exit(1);
    }

    const agentUser = (config.agentUser ?? "").trim();
    if (agentUser.length === 0) {
      process.stderr.write(
        "Error: No agent user configured. Run `automata config` or `automata config set agent-user <login>` to set it.\n",
      );
      process.exit(1);
    }

    let conversation: IssueConversation;
    try {
      conversation = getIssueConversation(issueNumber);
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(1);
    }

    const analysis = analyzeConversation(conversation, allowedUsers, agentUser);

    if (!analysis.hasNewMessage && !options.force) {
      const since = analysis.lastAgentAt === null ? "" : ` (last agent message: ${analysis.lastAgentAt})`;
      process.stdout.write(
        `No new messages from allowed users on issue #${String(issueNumber)}${since}. Use --force to invoke the AI anyway.\n`,
      );
      return;
    }

    if (analysis.hasNewMessage) {
      process.stdout.write(
        `Found ${String(analysis.newMessageCount)} new message${pluralSuffix(analysis.newMessageCount)} on issue #${String(issueNumber)}. Invoking AI…\n`,
      );
    } else {
      process.stdout.write(`No new messages on issue #${String(issueNumber)} — forced run. Invoking AI…\n`);
    }

    const promptText = config.prompts?.checkIssue ?? DEFAULT_CHECK_ISSUE_PROMPT;
    const fullPrompt = withPush(
      `${promptText}\n\nIssue #${String(issueNumber)}: ${conversation.title}\nURL: ${conversation.url}` +
        `\n\nConversation (only messages from allowed users and the agent, oldest first):` +
        `\n\n${formatConversation(analysis.messages)}`,
      options.push,
    );

    // The marker comment is the only record of this run, so the AI must not
    // start unless it is safely on the issue — otherwise the same message
    // would start a fresh run on every later invocation.
    const marker = analysis.hasNewMessage
      ? `automata check-issue: picked up ${String(analysis.newMessageCount)} new message${pluralSuffix(analysis.newMessageCount)}, starting an agent run.`
      : "automata check-issue: forced run, starting an agent run.";
    try {
      postComment(issueNumber, marker);
    } catch (err) {
      process.stderr.write(
        `Error: could not post the execution marker comment on issue #${String(issueNumber)}: ${(err as Error).message}\n`,
      );
      process.exit(1);
    }

    await invokeSelectedExecutor(fullPrompt, executor, options);
  });

export const executePromptCommand = new Command("execute-prompt")
  .description("Execute a configured custom prompt using an AI assistant")
  .addCommand(executeSonarCmd)
  .addCommand(executeFixCommentsCmd)
  .addCommand(executeCheckIssueCmd);
