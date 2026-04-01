import { Command } from "commander";
import { invokeClaudeCode, resolveModelOption } from "../claude/claudeService.js";
import { invokeCodexCode } from "../codex/codexService.js";

const testClaudeCmd = new Command("claude")
  .description("Test Claude Code invocation with a user-supplied prompt")
  .requiredOption("--prompt <string>", "Prompt to send to Claude Code")
  .option("--yolo", "Launch Claude Code with --dangerously-skip-permissions")
  .option("--verbose", "Show step-by-step progress summary and final result")
  .option("--opus",   "Use claude-opus-4-6")
  .option("--sonnet", "Use claude-sonnet-4-6")
  .option("--haiku",  "Use claude-haiku-4-5-20251001")
  .action(async (options: { prompt: string; yolo?: boolean; verbose?: boolean; opus?: boolean; sonnet?: boolean; haiku?: boolean }) => {
    const model = resolveModelOption(options);
    await invokeClaudeCode(options.prompt, { yolo: options.yolo, verbose: options.verbose, model });
  });

const testCodexCmd = new Command("codex")
  .description("Test Codex CLI invocation with a user-supplied prompt")
  .requiredOption("--prompt <string>", "Prompt to send to Codex CLI")
  .option("--yolo", "Launch Codex with --dangerously-bypass-approvals-and-sandbox")
  .option("--verbose", "Show step-by-step progress summary and final result")
  .action(async (options: { prompt: string; yolo?: boolean; verbose?: boolean }) => {
    await invokeCodexCode(options.prompt, { yolo: options.yolo, verbose: options.verbose });
  });

export const testCommand = new Command("test")
  .description("Test commands for verifying automata integrations")
  .addCommand(testClaudeCmd)
  .addCommand(testCodexCmd);
