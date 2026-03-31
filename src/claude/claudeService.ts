import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

export function resolveCommand(name: string): string {
  const pathDirs = (process.env["PATH"] ?? "").split(delimiter);
  for (const dir of pathDirs) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return name;
}

export function invokeClaudeCode(prompt: string, yolo: boolean): void {
  const claudeBin = resolveCommand("claude");
  const args = yolo ? ["--dangerously-skip-permissions", "-p", prompt] : ["-p", prompt];
  const result = spawnSync(claudeBin, args, { encoding: "utf8", stdio: "inherit" });
  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      process.stderr.write("Error: `claude` CLI is not installed or not on PATH.\n");
      process.exit(1);
    }
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.stderr.write(`Error: Claude Code exited with code ${result.status ?? "unknown"}.\n`);
    process.exit(result.status ?? 1);
  }
}
