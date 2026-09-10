import { spawn, spawnSync } from "node:child_process";
import { resolveCommand } from "../claude/claudeService.js";
import { handleSpawnError, handleExitCode } from "../cli/spawnUtils.js";
import { trackChild, untrackChild } from "../cli/childRegistry.js";

export interface InvokeCodexOptions {
  yolo?: boolean;
  verbose?: boolean;
  model?: string;
  /** Reasoning effort, forwarded verbatim. See `InvokeClaudeOptions.effort`. */
  effort?: string;
}

/** The argv `invokeCodexCode` will spawn. See `buildClaudeArgs` for why. */
export function buildCodexArgs(prompt: string, options: InvokeCodexOptions = {}): string[] {
  const args: string[] = ["exec"];
  if (options.yolo) args.push("--dangerously-bypass-approvals-and-sandbox");
  if (options.model) args.push("--model", options.model);
  // Codex has no effort flag: it reads `model_reasoning_effort` from its TOML
  // config, and `-c` is the documented per-invocation override. The value is
  // quoted because `-c` parses that half as TOML, where a bare word is not a
  // string.
  if (options.effort) args.push("-c", `model_reasoning_effort="${options.effort}"`);
  args.push(prompt);
  return args;
}

export function invokeCodexCode(prompt: string, options: InvokeCodexOptions = {}): void {
  if (options.verbose) {
    process.stderr.write("Warning: --verbose is not supported for Codex and will be ignored.\n");
  }
  invokeCodexCodeSync(prompt, options.yolo ?? false, options.model, options.effort);
}

function invokeCodexCodeSync(
  prompt: string,
  yolo: boolean,
  model: string | undefined,
  effort: string | undefined,
): void {
  const codexBin = resolveCommand("codex");
  const args = buildCodexArgs(prompt, { yolo, model, effort });
  const result = spawnSync(codexBin, args, { encoding: "utf8", stdio: "inherit" });
  handleSpawnError(result.error, "codex");
  handleExitCode(result.status, "Codex");
}

/**
 * Run Codex for an unattended caller: asynchronously spawned and tracked so a
 * signal handler can stop it, and throwing rather than exiting on failure.
 *
 * `invokeCodexCode` uses `spawnSync`, which blocks the event loop — so a signal
 * arriving mid-run cannot be handled until the child finishes, and a non-zero
 * status exits the process. See `runClaude` for why a tick cannot accept either.
 */
export function runCodex(prompt: string, options: { model?: string; effort?: string } = {}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const codexBin = resolveCommand("codex");
    const args = buildCodexArgs(prompt, { yolo: true, model: options.model, effort: options.effort });
    const child = spawn(codexBin, args, { stdio: "inherit" });
    trackChild(child);

    child.on("error", (err) => {
      untrackChild(child);
      const nodeErr = err as NodeJS.ErrnoException;
      reject(
        nodeErr.code === "ENOENT"
          ? new Error("`codex` CLI is not installed or not on PATH.")
          : new Error(nodeErr.message),
      );
    });

    child.on("close", (code, signal) => {
      untrackChild(child);
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal === null ? `Codex exited with code ${String(code)}.` : `Codex terminated on ${signal}.`,
        ),
      );
    });
  });
}
