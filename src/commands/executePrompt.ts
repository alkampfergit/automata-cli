import { Command } from "commander";
import { getCurrentBranch, getPrInfo, getPrComments, type PrComment } from "../git/gitService.js";
import { readConfig, DEFAULT_SONAR_PROMPT, DEFAULT_FIX_COMMENTS_PROMPT } from "../config/configStore.js";
import { invokeClaudeCode, resolveModelOption } from "../claude/claudeService.js";
import { invokeCodexCode } from "../codex/codexService.js";

const PUSH_INSTRUCTION =
  "Once all changes are complete, stage every modified file, create a single commit with a clear and descriptive commit message that summarises what was fixed, and push the branch to the remote.";

function withPush(prompt: string, push: boolean | undefined): string {
  return push ? `${prompt}\n\n${PUSH_INSTRUCTION}` : prompt;
}

const executeSonarCmd = new Command("sonar")
  .description(
    "Check the current branch for a SonarCloud analysis and invoke the AI with the Sonar prompt and analysis URL",
  )
  .option("--codex", "Use Codex CLI instead of Claude Code")
  .option("--verbose", "Show step-by-step progress (Claude only; ignored for Codex)")
  .option("--push", "Append instruction to commit and push changes after the AI finishes")
  .option("--opus", "Use claude-opus-4-6 (Claude only)")
  .option("--sonnet", "Use claude-sonnet-4-6 (Claude only)")
  .option("--haiku", "Use claude-haiku-4-5-20251001 (Claude only)")
  .action(
    async (options: {
      codex?: boolean;
      verbose?: boolean;
      push?: boolean;
      opus?: boolean;
      sonnet?: boolean;
      haiku?: boolean;
    }) => {
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
        `${sonarPromptText}\n\nSonarCloud analysis URL: ${pr.sonarcloudUrl}`,
        options.push,
      );

      if (options.codex) {
        invokeCodexCode(fullPrompt, { yolo: true });
      } else {
        const model = resolveModelOption(options);
        await invokeClaudeCode(fullPrompt, { yolo: true, verbose: options.verbose, model });
      }
    },
  );

function formatComments(comments: PrComment[]): string {
  return comments
    .map((c) => {
      const loc = c.line === null ? `${c.path}:(file)` : `${c.path}:${String(c.line)}`;
      return `[${c.author}] on ${loc}\n${c.body}`;
    })
    .join("\n\n");
}

const executeFixCommentsCmd = new Command("fix-comments")
  .description(
    "Fetch open review comments on the current PR and invoke the AI with the Fix-Comments prompt",
  )
  .option("--codex", "Use Codex CLI instead of Claude Code")
  .option("--verbose", "Show step-by-step progress (Claude only; ignored for Codex)")
  .option("--push", "Append instruction to commit and push changes after the AI finishes")
  .option("--opus", "Use claude-opus-4-6 (Claude only)")
  .option("--sonnet", "Use claude-sonnet-4-6 (Claude only)")
  .option("--haiku", "Use claude-haiku-4-5-20251001 (Claude only)")
  .action(
    async (options: {
      codex?: boolean;
      verbose?: boolean;
      push?: boolean;
      opus?: boolean;
      sonnet?: boolean;
      haiku?: boolean;
    }) => {
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
          `Error: fix-comments is not supported for Azure DevOps. See docs/azdo-gap.md for details.\n`,
        );
        process.exit(1);
      }

      if (comments === null) {
        process.stderr.write(`Error: No pull request found for branch: ${branch}\n`);
        process.exit(1);
      }

      if (comments.length === 0) {
        process.stderr.write(`Error: No open review comments found on the pull request.\n`);
        process.exit(1);
      }

      const config = readConfig();
      const promptText = config.prompts?.fixComments ?? DEFAULT_FIX_COMMENTS_PROMPT;
      const fullPrompt = withPush(
        `${promptText}\n\nOpen review comments:\n\n${formatComments(comments)}`,
        options.push,
      );

      if (options.codex) {
        invokeCodexCode(fullPrompt, { yolo: true });
      } else {
        const model = resolveModelOption(options);
        await invokeClaudeCode(fullPrompt, { yolo: true, verbose: options.verbose, model });
      }
    },
  );

export const executePromptCommand = new Command("execute-prompt")
  .description("Execute a configured custom prompt using an AI assistant")
  .addCommand(executeSonarCmd)
  .addCommand(executeFixCommentsCmd);
