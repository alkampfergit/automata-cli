import { spawnSync } from "node:child_process";
import { resolveCommand } from "../claude/claudeService.js";
import { handleSpawnError, handleExitCode } from "../cli/spawnUtils.js";

export interface InvokeCodexOptions {
  yolo?: boolean;
  verbose?: boolean;
  model?: string;
}

/** The argv `invokeCodexCode` will spawn. See `buildClaudeArgs` for why. */
export function buildCodexArgs(prompt: string, options: InvokeCodexOptions = {}): string[] {
  const args: string[] = ["exec"];
  if (options.yolo) args.push("--dangerously-bypass-approvals-and-sandbox");
  if (options.model) args.push("--model", options.model);
  args.push(prompt);
  return args;
}

export function invokeCodexCode(prompt: string, options: InvokeCodexOptions = {}): void {
  if (options.verbose) {
    process.stderr.write("Warning: --verbose is not supported for Codex and will be ignored.\n");
  }
  invokeCodexCodeSync(prompt, options.yolo ?? false, options.model);
}

function invokeCodexCodeSync(prompt: string, yolo: boolean, model: string | undefined): void {
  const codexBin = resolveCommand("codex");
  const args = buildCodexArgs(prompt, { yolo, model });
  const result = spawnSync(codexBin, args, { encoding: "utf8", stdio: "inherit" });
  handleSpawnError(result.error, "codex");
  handleExitCode(result.status, "Codex");
}
