import { Command } from "commander";
import { getCurrentBranch, getPrInfo } from "../git/gitService.js";
import { readConfig, DEFAULT_SONAR_PROMPT } from "../config/configStore.js";
import { invokeClaudeCode, resolveModelOption } from "../claude/claudeService.js";
import { invokeCodexCode } from "../codex/codexService.js";

const executeSonarCmd = new Command("sonar")
  .description(
    "Check the current branch for a SonarCloud analysis and invoke the AI with the Sonar prompt and analysis URL",
  )
  .option("--codex", "Use Codex CLI instead of Claude Code")
  .option("--verbose", "Show step-by-step progress (Claude only; ignored for Codex)")
  .option("--opus", "Use claude-opus-4-6 (Claude only)")
  .option("--sonnet", "Use claude-sonnet-4-6 (Claude only)")
  .option("--haiku", "Use claude-haiku-4-5-20251001 (Claude only)")
  .action(
    async (options: {
      codex?: boolean;
      verbose?: boolean;
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
      const fullPrompt = `${sonarPromptText}\n\nSonarCloud analysis URL: ${pr.sonarcloudUrl}`;

      if (options.codex) {
        invokeCodexCode(fullPrompt, { verbose: options.verbose });
      } else {
        const model = resolveModelOption(options);
        await invokeClaudeCode(fullPrompt, { verbose: options.verbose, model });
      }
    },
  );

export const executePromptCommand = new Command("execute-prompt")
  .description("Execute a configured custom prompt using an AI assistant")
  .addCommand(executeSonarCmd);
