import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { resolveCommand } from "../claude/claudeService.js";
import { truncate, handleSpawnError, handleExitCode } from "../cli/spawnUtils.js";

export interface InvokeCodexOptions {
  yolo?: boolean;
  verbose?: boolean;
}

export function invokeCodexCode(prompt: string, options: InvokeCodexOptions = {}): void | Promise<void> {
  if (options.verbose) {
    return invokeCodexCodeVerbose(prompt, options.yolo ?? false);
  }
  invokeCodexCodeSync(prompt, options.yolo ?? false);
}

function invokeCodexCodeSync(prompt: string, yolo: boolean): void {
  const codexBin = resolveCommand("codex");
  const args: string[] = ["exec"];
  if (yolo) args.push("--dangerously-bypass-approvals-and-sandbox");
  args.push(prompt);
  const result = spawnSync(codexBin, args, { encoding: "utf8", stdio: "inherit" });
  handleSpawnError(result.error, "codex");
  handleExitCode(result.status, "Codex");
}

function invokeCodexCodeVerbose(prompt: string, yolo: boolean): Promise<void> {
  return new Promise<void>((resolve) => {
    const codexBin = resolveCommand("codex");
    const args: string[] = ["exec"];
    if (yolo) args.push("--dangerously-bypass-approvals-and-sandbox");
    args.push("--json", prompt);

    const child = spawn(codexBin, args, { stdio: ["inherit", "pipe", "inherit"] });
    const rl = createInterface({ input: child.stdout });
    let stepCount = 0;

    child.on("error", (err) => {
      handleSpawnError(err, "codex");
    });

    rl.on("line", (line) => {
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        formatCodexEvent(event, stepCount);
        if (event["type"] === "agent_message" || event["type"] === "tool_call") stepCount++;
      } catch {
        // skip non-JSON lines
      }
    });

    child.on("close", (code) => {
      handleExitCode(code, "Codex");
      resolve();
    });
  });
}

function formatCodexEvent(event: Record<string, unknown>, stepCount: number): void {
  const type = event["type"] as string | undefined;

  if (type === "tool_call") {
    const name = event["name"] as string | undefined;
    const input = event["input"] as Record<string, unknown> | undefined;
    const summary = name ? summarizeCodexTool(name, input) : "tool call";
    process.stderr.write(`  [step ${stepCount + 1}] ${summary}\n`);
  } else if (type === "agent_message") {
    const content = event["content"] as string | undefined;
    if (content && content.length > 0) {
      const preview = content.length > 120 ? content.slice(0, 120) + "..." : content;
      const firstLine = preview.split("\n")[0] ?? preview;
      process.stderr.write(`  [step ${stepCount + 1}] ${firstLine}\n`);
    }
  } else if (type === "session_complete" || type === "completed") {
    const result = event["result"] as string | undefined;
    process.stderr.write("\n--- Result ---\n");
    if (result) {
      process.stdout.write(result + "\n");
    }
  }
}

function summarizeCodexTool(name: string, input: Record<string, unknown> | undefined): string {
  if (!input) return `tool: ${name}`;

  switch (name) {
    case "shell":
      return `running: ${truncate(String(input["cmd"] ?? input["command"] ?? ""), 80)}`;
    case "read_file":
      return `reading ${input["path"] ?? "file"}`;
    case "write_file":
      return `writing ${input["path"] ?? "file"}`;
    case "list_files":
      return `listing files: ${input["path"] ?? "."}`;
    default:
      return `tool: ${name}`;
  }
}
