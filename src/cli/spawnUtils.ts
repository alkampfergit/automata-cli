/**
 * Quote one argv entry so the printed command can be pasted into a shell and
 * behave identically. Single quotes are literal in POSIX shells apart from the
 * quote character itself, which has to be closed, escaped and reopened.
 */
const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;
/** Close the quote, escape the apostrophe, reopen: `'` becomes `'\''`. */
const ESCAPED_QUOTE = String.raw`'\''`;

export function shellQuote(arg: string): string {
  if (SHELL_SAFE.test(arg)) return arg;
  return "'" + arg.replaceAll("'", ESCAPED_QUOTE) + "'";
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

/**
 * Normalise an `--effort` option value.
 *
 * The level itself is deliberately not checked against a list: the valid set is
 * executor- *and* model-specific (`claude`: low|medium|high|xhigh|max; `codex`:
 * minimal|low|medium|high, plus xhigh on max-class models) and changes between
 * executor releases, so an allow-list here would reject a level the installed
 * binary accepts until automata cut a release of its own. Only an empty value
 * is refused, because it would emit a flag with no operand.
 */
export function resolveEffortOption(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    process.stderr.write("Error: --effort must be a non-empty level.\n");
    process.exit(1);
  }
  return trimmed;
}
