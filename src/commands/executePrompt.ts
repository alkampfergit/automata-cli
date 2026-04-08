import { Command } from "commander";
import { getCurrentBranch, getPrInfo, resolveCurrentBranchComments, type PrComment, type PrInfo } from "../git/gitService.js";
import { readConfig, DEFAULT_SONAR_PROMPT, DEFAULT_FIX_COMMENTS_PROMPT } from "../config/configStore.js";
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

export const executePromptCommand = new Command("execute-prompt")
  .description("Execute a configured custom prompt using an AI assistant")
  .addCommand(executeSonarCmd)
  .addCommand(executeFixCommentsCmd);
