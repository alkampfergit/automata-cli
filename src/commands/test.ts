import { Command } from "commander";
import { invokeClaudeCode } from "../claude/claudeService.js";

const MODEL_IDS: Record<string, string> = {
  opus:   "claude-opus-4-6",
  sonnet: "claude-sonnet-4-6",
  haiku:  "claude-haiku-4-5-20251001",
};

const testClaudeCmd = new Command("claude")
  .description("Test Claude Code invocation with a user-supplied prompt")
  .requiredOption("--prompt <string>", "Prompt to send to Claude Code")
  .option("--yolo", "Launch Claude Code with --dangerously-skip-permissions")
  .option("--verbose", "Show step-by-step progress summary and final result")
  .option("--opus",   "Use claude-opus-4-6")
  .option("--sonnet", "Use claude-sonnet-4-6")
  .option("--haiku",  "Use claude-haiku-4-5-20251001")
  .action(async (options: { prompt: string; yolo?: boolean; verbose?: boolean; opus?: boolean; sonnet?: boolean; haiku?: boolean }) => {
    const selected = (["opus", "sonnet", "haiku"] as const).filter((m) => options[m]);
    if (selected.length > 1) {
      process.stderr.write(`Error: --${selected[0]} and --${selected[1]} are mutually exclusive.\n`);
      process.exit(1);
    }
    const model = selected.length === 1 ? MODEL_IDS[selected[0]] : undefined;
    await invokeClaudeCode(options.prompt, { yolo: options.yolo, verbose: options.verbose, model });
  });

export const testCommand = new Command("test")
  .description("Test commands for verifying automata integrations")
  .addCommand(testClaudeCmd);
