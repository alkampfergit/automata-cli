import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { truncate, handleSpawnError, handleExitCode } from "../cli/spawnUtils.js";
import { trackChild, untrackChild } from "../cli/childRegistry.js";

export function resolveCommand(name: string): string {
  const pathDirs = (process.env["PATH"] ?? "").split(delimiter);
  for (const dir of pathDirs) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return name;
}

export interface InvokeClaudeOptions {
  yolo?: boolean;
  verbose?: boolean;
  model?: string;
  /**
   * Reasoning effort, forwarded verbatim. Deliberately not validated against a
   * list of levels: the valid set is model-specific and changes between Claude
   * Code releases, so an allow-list here would reject a level the installed
   * binary accepts until automata cut a release of its own.
   */
  effort?: string;
}

export const MODEL_IDS: Record<string, string> = {
  opus:   "claude-opus-4-6",
  sonnet: "claude-sonnet-4-6",
  haiku:  "claude-haiku-4-5-20251001",
};

export function resolveModelOption(opts: { opus?: boolean; sonnet?: boolean; haiku?: boolean }): string | undefined {
  const selected = (["opus", "sonnet", "haiku"] as const).filter((m) => opts[m]);
  if (selected.length > 1) {
    process.stderr.write(`Error: --${selected[0]} and --${selected[1]} are mutually exclusive.\n`);
    process.exit(1);
  }
  return selected.length === 1 ? MODEL_IDS[selected[0]] : undefined;
}

/**
 * The argv `invokeClaudeCode` will spawn.
 *
 * Exported so `do-work --dry-run` can print the exact command it would run:
 * building the arguments twice would let the dry run drift from reality, which
 * is worse than not printing them at all.
 */
export function buildClaudeArgs(prompt: string, options: InvokeClaudeOptions = {}): string[] {
  const args: string[] = [];
  if (options.yolo) args.push("--dangerously-skip-permissions");
  if (options.model) args.push("--model", options.model);
  // Truthiness, not `!== undefined`: an empty level must emit nothing rather
  // than a bare `--effort` that would swallow the next argument.
  if (options.effort) args.push("--effort", options.effort);
  if (options.verbose) args.push("--verbose", "--output-format", "stream-json");
  args.push("-p", prompt);
  return args;
}

/**
 * Run Claude for an unattended caller: always asynchronously spawned so it can be
 * cancelled, always tracked so a signal handler can stop it, and **throwing**
 * rather than exiting on a non-zero status.
 *
 * `invokeClaudeCode` below routes failures through `handleExitCode`, which calls
 * `process.exit`. That is right for a one-shot CLI command but fatal for a tick:
 * the process would die mid-loop, leaving the marker comment unreconciled, the
 * remaining queue unprocessed and the `finally` that releases the lock skipped.
 *
 * `printSteps` controls output only; the argv is identical either way, so what
 * `--dry-run` prints is what runs.
 */
export function runClaude(
  prompt: string,
  options: { model?: string; effort?: string; printSteps?: boolean } = {},
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const claudeBin = resolveCommand("claude");
    const args = buildClaudeArgs(prompt, {
      yolo: true,
      model: options.model,
      effort: options.effort,
      verbose: true,
    });
    const child = spawn(claudeBin, args, { stdio: ["inherit", "pipe", "inherit"] });
    trackChild(child);

    const rl = createInterface({ input: child.stdout });
    let turnCount = 0;
    rl.on("line", (line) => {
      if (options.printSteps !== true) return;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        formatEvent(event, turnCount);
        if (event["type"] === "assistant") turnCount++;
      } catch {
        // skip non-JSON lines
      }
    });

    child.on("error", (err) => {
      untrackChild(child);
      const nodeErr = err as NodeJS.ErrnoException;
      reject(
        nodeErr.code === "ENOENT"
          ? new Error("`claude` CLI is not installed or not on PATH.")
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
          signal === null
            ? `Claude Code exited with code ${String(code)}.`
            : `Claude Code terminated on ${signal}.`,
        ),
      );
    });
  });
}

export function invokeClaudeCode(prompt: string, options: InvokeClaudeOptions = {}): void | Promise<void> {
  if (options.verbose) {
    return invokeClaudeCodeVerbose(prompt, options.yolo ?? false, options.model, options.effort);
  }
  invokeClaudeCodeSync(prompt, options.yolo ?? false, options.model, options.effort);
}

function invokeClaudeCodeSync(
  prompt: string,
  yolo: boolean,
  model: string | undefined,
  effort: string | undefined,
): void {
  const claudeBin = resolveCommand("claude");
  const args = buildClaudeArgs(prompt, { yolo, model, effort, verbose: false });
  const result = spawnSync(claudeBin, args, { encoding: "utf8", stdio: "inherit" });
  handleSpawnError(result.error, "claude");
  handleExitCode(result.status, "Claude Code");
}

function invokeClaudeCodeVerbose(
  prompt: string,
  yolo: boolean,
  model: string | undefined,
  effort: string | undefined,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const claudeBin = resolveCommand("claude");
    const args = buildClaudeArgs(prompt, { yolo, model, effort, verbose: true });

    const child = spawn(claudeBin, args, { stdio: ["inherit", "pipe", "inherit"] });
    const rl = createInterface({ input: child.stdout });
    let turnCount = 0;

    child.on("error", (err) => {
      handleSpawnError(err, "claude");
    });

    rl.on("line", (line) => {
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        formatEvent(event, turnCount);
        if (event["type"] === "assistant") turnCount++;
      } catch {
        // skip non-JSON lines
      }
    });

    child.on("close", (code) => {
      handleExitCode(code, "Claude Code");
      resolve();
    });
  });
}

function formatAssistantEvent(event: Record<string, unknown>, turnCount: number): void {
  const message = event["message"] as Record<string, unknown> | undefined;
  const content = message?.["content"] as Array<Record<string, unknown>> | undefined;
  if (!content) return;

  for (const block of content) {
    const line = formatContentBlock(block);
    if (line !== null) {
      process.stderr.write(`  [step ${turnCount + 1}] ${line}\n`);
    }
  }
}

function formatContentBlock(block: Record<string, unknown>): string | null {
  if (block["type"] === "tool_use") {
    const toolName = block["name"] as string;
    const input = block["input"] as Record<string, unknown> | undefined;
    return summarizeTool(toolName, input);
  }

  if (block["type"] === "text") {
    const text = (block["text"] as string) ?? "";
    if (text.length === 0) return null;
    const preview = text.length > 120 ? text.slice(0, 120) + "..." : text;
    return preview.split("\n")[0] ?? null;
  }

  return null;
}

function formatResultEvent(event: Record<string, unknown>): void {
  const result = event["result"] as string | undefined;
  const cost = event["cost_usd"] as number | undefined;
  const duration = event["duration_ms"] as number | undefined;
  const turns = event["num_turns"] as number | undefined;

  process.stderr.write("\n--- Result ---\n");

  const parts: string[] = [];
  if (turns !== undefined) parts.push(`${turns} turns`);
  if (duration !== undefined) parts.push(`${(duration / 1000).toFixed(1)}s`);
  if (cost !== undefined) parts.push(`$${cost.toFixed(4)}`);
  if (parts.length > 0) {
    process.stderr.write(`  [info] ${parts.join(" | ")}\n`);
  }

  if (result) {
    process.stdout.write(result + "\n");
  }
}

function formatEvent(event: Record<string, unknown>, turnCount: number): void {
  const type = event["type"] as string | undefined;

  if (type === "assistant") {
    formatAssistantEvent(event, turnCount);
  } else if (type === "result") {
    formatResultEvent(event);
  }
}

// Tool inputs come from an untyped JSON stream, so a field can be any shape.
// Only strings are meaningful here; anything else falls back to the default.
function asText(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function summarizeTool(name: string, input: Record<string, unknown> | undefined): string {
  if (!input) return `tool: ${name}`;

  switch (name) {
    case "Read":
      return `reading ${asText(input["file_path"], "file")}`;
    case "Write":
      return `writing ${asText(input["file_path"], "file")}`;
    case "Edit":
      return `editing ${asText(input["file_path"], "file")}`;
    case "Bash":
      return `running: ${truncate(asText(input["command"], ""), 80)}`;
    case "Glob":
      return `searching files: ${asText(input["pattern"], "")}`;
    case "Grep":
      return `searching content: ${truncate(asText(input["pattern"], ""), 60)}`;
    case "Agent":
      return `spawning agent: ${asText(input["description"], name)}`;
    default:
      return `tool: ${name}`;
  }
}

