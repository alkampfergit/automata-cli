import { spawnSync } from "node:child_process";
import { resolveCommand } from "../claude/claudeService.js";
import { handleSpawnError, handleExitCode } from "../cli/spawnUtils.js";

export interface InvokeCodexOptions {
  yolo?: boolean;
  verbose?: boolean;
  model?: string;
}

export function invokeCodexCode(prompt: string, options: InvokeCodexOptions = {}): void {
  if (options.verbose) {
    process.stderr.write("Warning: --verbose is not supported for Codex and will be ignored.\n");
  }
  invokeCodexCodeSync(prompt, options.yolo ?? false, options.model);
}

function invokeCodexCodeSync(prompt: string, yolo: boolean, model: string | undefined): void {
  const codexBin = resolveCommand("codex");
  const args: string[] = ["exec"];
  if (yolo) args.push("--dangerously-bypass-approvals-and-sandbox");
  if (model) args.push("--model", model);
  args.push(prompt);
  const result = spawnSync(codexBin, args, { encoding: "utf8", stdio: "inherit" });
  handleSpawnError(result.error, "codex");
  handleExitCode(result.status, "Codex");
}
