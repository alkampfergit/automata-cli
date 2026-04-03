import { readFileSync } from "node:fs";
import { Command } from "commander";
import { invokeClaudeCode } from "../claude/claudeService.js";
import { invokeCodexCode } from "../codex/codexService.js";

type ExecuteOptions = {
  with: string;
  prompt?: string;
  filePrompt?: string;
  silent?: boolean;
  model?: string;
};

function readStdin(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8").trim()));
    process.stdin.on("error", reject);
  });
}

async function resolvePrompt(options: ExecuteOptions): Promise<string> {
  const hasCli = options.prompt !== undefined;
  const hasFile = options.filePrompt !== undefined;
  const hasStdin = !process.stdin.isTTY;

  if (hasCli && (hasFile || hasStdin)) {
    process.stderr.write("Error: --prompt is mutually exclusive with --file-prompt and stdin.\n");
    process.exit(1);
  }

  if (hasCli) {
    return options.prompt as string;
  }

  if (hasFile) {
    const path = options.filePrompt as string;
    try {
      return readFileSync(path, "utf8");
    } catch {
      process.stderr.write(`Error: Cannot read file: ${path}\n`);
      process.exit(1);
    }
  }

  if (hasStdin) {
    const content = await readStdin();
    if (content.length === 0) {
      process.stderr.write("Error: No prompt provided. Use --prompt, --file-prompt, or pipe via stdin.\n");
      process.exit(1);
    }
    return content;
  }

  process.stderr.write("Error: No prompt provided. Use --prompt, --file-prompt, or pipe via stdin.\n");
  process.exit(1);
}

export const executeCommand = new Command("execute")
  .description("Delegate work to an AI executor")
  .requiredOption("--with <executor>", "Executor to use: claude or codex")
  .option("--prompt <string>", "Prompt to send to the executor")
  .option("--file-prompt <path>", "Path to a file whose content is used as the prompt")
  .option("--silent", "Suppress step-by-step output; show only the final summary")
  .option("--model <string>", "Model identifier to pass to the executor")
  .action(async (options: ExecuteOptions) => {
    const executor = options.with.toLowerCase();
    if (executor !== "claude" && executor !== "codex") {
      process.stderr.write(`Error: --with must be 'claude' or 'codex', got '${options.with}'.\n`);
      process.exit(1);
    }

    const prompt = await resolvePrompt(options);

    if (executor === "codex") {
      invokeCodexCode(prompt, { yolo: true, model: options.model });
    } else {
      await invokeClaudeCode(prompt, { yolo: true, verbose: !options.silent, model: options.model });
    }
  });
