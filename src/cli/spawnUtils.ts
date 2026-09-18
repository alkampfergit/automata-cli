import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * Fully qualify an executable name against `PATH`.
 *
 * Callers spawn the result instead of the bare name, so what gets executed is
 * decided here, once, rather than by the child process' own `PATH` search. When
 * nothing on `PATH` matches, the bare name is returned: the caller then either
 * reports "not on PATH" (`do-work --check`) or lets `spawnSync` fail with
 * ENOENT, both of which are better than this function throwing.
 */
export function resolveCommand(name: string): string {
  const pathDirs = (process.env["PATH"] ?? "").split(delimiter);
  for (const dir of pathDirs) {
    const candidate = join(dir, name);
    if (isLaunchable(candidate)) return candidate;
  }
  return name;
}

/**
 * What `spawn` will actually accept: a regular file with an execute bit.
 *
 * Mere existence is not enough. A directory called `claude`, or a non-executable
 * file left on `PATH` by a half-finished install, would make `do-work --check`
 * report the executor as available and the tick would then die with `EISDIR` or
 * `EACCES` — the check has to agree with the launcher, not with the filesystem.
 */
function isLaunchable(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) return false;
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

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
    process.stderr.write(
      `Error: ${toolName} terminated abnormally (exit code is null, likely due to a signal).\n`,
    );
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
export type EffortOptionResult =
  { ok: true; value: string | undefined } | { ok: false; error: string };

/**
 * The decision, without the exit. `do-work --check` has to *report* a bad
 * `--effort` rather than die on it — a diagnostic that exits before printing a
 * section is no diagnostic — so the rule lives here and each caller chooses what
 * to do with a rejection.
 */
export function normalizeEffortOption(value: string | undefined): EffortOptionResult {
  if (value === undefined) return { ok: true, value: undefined };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, error: "--effort must be a non-empty level." };
  return { ok: true, value: trimmed };
}

export function resolveEffortOption(value: string | undefined): string | undefined {
  const result = normalizeEffortOption(value);
  if (!result.ok) {
    process.stderr.write(`Error: ${result.error}\n`);
    process.exit(1);
  }
  return result.value;
}
