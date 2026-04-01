export function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + "..." : str;
}

export function handleSpawnError(error: Error | undefined, toolName: string): void {
  if (!error) return;
  const err = error as NodeJS.ErrnoException;
  if (err.code === "ENOENT") {
    process.stderr.write(`Error: \`${toolName}\` CLI is not installed or not on PATH.\n`);
    process.exit(1);
  }
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
}

export function handleExitCode(status: number | null, toolName: string): void {
  if (status === null) {
    process.stderr.write(`Error: ${toolName} terminated abnormally (exit code is null, likely due to a signal).\n`);
    process.exit(1);
  }
  if (status !== 0) {
    process.stderr.write(`Error: ${toolName} exited with code ${status}.\n`);
    process.exit(status);
  }
}
