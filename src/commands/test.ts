import { Command } from "commander";
import { invokeClaudeCode } from "../claude/claudeService.js";

const testClaudeCmd = new Command("claude")
  .description("Test Claude Code invocation with a user-supplied prompt")
  .requiredOption("--prompt <string>", "Prompt to send to Claude Code")
  .option("--yolo", "Launch Claude Code with --dangerously-skip-permissions")
  .action((options: { prompt: string; yolo?: boolean }) => {
    invokeClaudeCode(options.prompt, options.yolo ?? false);
  });

export const testCommand = new Command("test")
  .description("Test commands for verifying automata integrations")
  .addCommand(testClaudeCmd);
