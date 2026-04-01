import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { truncate, handleSpawnError, handleExitCode } from "../cli/spawnUtils.js";

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

export function invokeClaudeCode(prompt: string, options: InvokeClaudeOptions = {}): void | Promise<void> {
  if (options.verbose) {
    return invokeClaudeCodeVerbose(prompt, options.yolo ?? false, options.model);
  }
  invokeClaudeCodeSync(prompt, options.yolo ?? false, options.model);
}

function invokeClaudeCodeSync(prompt: string, yolo: boolean, model: string | undefined): void {
  const claudeBin = resolveCommand("claude");
  const args: string[] = [];
  if (yolo) args.push("--dangerously-skip-permissions");
  if (model) args.push("--model", model);
  args.push("-p", prompt);
  const result = spawnSync(claudeBin, args, { encoding: "utf8", stdio: "inherit" });
  handleSpawnError(result.error, "claude");
  handleExitCode(result.status, "Claude Code");
}

function invokeClaudeCodeVerbose(prompt: string, yolo: boolean, model: string | undefined): Promise<void> {
  return new Promise<void>((resolve) => {
    const claudeBin = resolveCommand("claude");
    const args: string[] = [];
    if (yolo) args.push("--dangerously-skip-permissions");
    if (model) args.push("--model", model);
    args.push("--verbose", "--output-format", "stream-json", "-p", prompt);

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

function formatEvent(event: Record<string, unknown>, turnCount: number): void {
  const type = event["type"] as string | undefined;

  if (type === "assistant") {
    const message = event["message"] as Record<string, unknown> | undefined;
    const content = message?.["content"] as Array<Record<string, unknown>> | undefined;
    if (!content) return;

    for (const block of content) {
      if (block["type"] === "tool_use") {
        const toolName = block["name"] as string;
        const input = block["input"] as Record<string, unknown> | undefined;
        const summary = summarizeTool(toolName, input);
        process.stderr.write(`  [step ${turnCount + 1}] ${summary}\n`);
      } else if (block["type"] === "text") {
        const text = (block["text"] as string) ?? "";
        if (text.length > 0) {
          const preview = text.length > 120 ? text.slice(0, 120) + "..." : text;
          const firstLine = preview.split("\n")[0];
          process.stderr.write(`  [step ${turnCount + 1}] ${firstLine}\n`);
        }
      }
    }
  } else if (type === "result") {
    const result = event["result"] as string | undefined;
    const cost = event["cost_usd"] as number | undefined;
    const duration = event["duration_ms"] as number | undefined;
    const turns = event["num_turns"] as number | undefined;

    process.stderr.write("\n--- Result ---\n");
    if (cost !== undefined || duration !== undefined || turns !== undefined) {
      const parts: string[] = [];
      if (turns !== undefined) parts.push(`${turns} turns`);
      if (duration !== undefined) parts.push(`${(duration / 1000).toFixed(1)}s`);
      if (cost !== undefined) parts.push(`$${cost.toFixed(4)}`);
      process.stderr.write(`  [info] ${parts.join(" | ")}\n`);
    }
    if (result) {
      process.stdout.write(result + "\n");
    }
  }
}

function summarizeTool(name: string, input: Record<string, unknown> | undefined): string {
  if (!input) return `tool: ${name}`;

  switch (name) {
    case "Read":
      return `reading ${input["file_path"] ?? "file"}`;
    case "Write":
      return `writing ${input["file_path"] ?? "file"}`;
    case "Edit":
      return `editing ${input["file_path"] ?? "file"}`;
    case "Bash":
      return `running: ${truncate(String(input["command"] ?? ""), 80)}`;
    case "Glob":
      return `searching files: ${input["pattern"] ?? ""}`;
    case "Grep":
      return `searching content: ${truncate(String(input["pattern"] ?? ""), 60)}`;
    case "Agent":
      return `spawning agent: ${input["description"] ?? name}`;
    default:
      return `tool: ${name}`;
  }
}

