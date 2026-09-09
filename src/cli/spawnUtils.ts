/**
 * Quote one argv entry so the printed command can be pasted into a shell and
 * behave identically. Single quotes are literal in POSIX shells apart from the
 * quote character itself, which has to be closed, escaped and reopened.
 */
export function shellQuote(arg: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) return arg;
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

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
