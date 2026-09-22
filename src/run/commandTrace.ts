/**
 * A recording of the `git` and `gh` invocations a report made.
 *
 * `do-work --check` answers questions about a checkout by shelling out, and when
 * its answer is surprising the next question is always "what did you actually
 * run?". Threading a recorder through every service signature to answer that
 * would touch dozens of functions for a diagnostic, so the sink is process-wide
 * and off by default: `recordCommand` returns on a null check when nobody asked
 * for a trace, which is every invocation except `--verbose`.
 *
 * Deliberately not a general instrumentation layer. Only the four `spawnSync`
 * wrappers report here, so the trace is exactly "the external commands automata
 * itself issued" — the executor's own children are out of scope and stay out.
 */

export interface TracedCommand {
  /** As invoked: `git`, `gh`, or the absolute path a caller resolved first. */
  command: string;
  args: string[];
  durationMs: number;
  /**
   * The process's exit status, or `-1` when the command never started at all —
   * a binary missing from PATH, say. All four wrappers report it that way, so a
   * fault the caller flattens into an ordinary failure is still legible here.
   */
  exitCode: number;
}

/**
 * Null means "not tracing", which is not the same as an empty trace: a report
 * that ran no command must be able to say so, and one that never asked for a
 * trace must not claim it.
 */
let sink: TracedCommand[] | null = null;

export function startCommandTrace(): void {
  sink = [];
}

export function stopCommandTrace(): void {
  sink = null;
}

export function isTracing(): boolean {
  return sink !== null;
}

/**
 * The recorded commands, oldest first, leaving tracing off afterwards.
 *
 * Returns null when tracing was never started, so a caller can tell "no trace
 * was asked for" from "a trace was asked for and nothing ran".
 */
export function takeCommandTrace(): TracedCommand[] | null {
  const taken = sink;
  sink = null;
  return taken;
}

/**
 * Record one invocation. `startedAt` is a `Date.now()` taken before the spawn,
 * so the duration covers the child's whole life.
 *
 * Never throws: a diagnostic that could take down the command it is observing
 * would be worse than no diagnostic, and this sits inside the hot path of every
 * git call automata makes.
 */
export function recordCommand(
  command: string,
  args: readonly string[],
  startedAt: number,
  exitCode: number,
): void {
  if (sink === null) return;
  sink.push({
    command,
    args: [...args],
    // A clock that went backwards must not produce a negative duration in a
    // report an operator is reading for anomalies.
    durationMs: Math.max(0, Date.now() - startedAt),
    exitCode,
  });
}

/** `git rev-parse --short HEAD — 8ms exit 0`, with long argument lists cut. */
export function describeTracedCommand(traced: TracedCommand): string {
  const rendered = [traced.command, ...traced.args].join(" ");
  const flat = rendered.replace(/\s+/g, " ").trim();
  const shown = flat.length <= MAX_COMMAND_LENGTH ? flat : `${flat.slice(0, MAX_COMMAND_LENGTH)}…`;
  return `${shown} — ${String(traced.durationMs)}ms exit ${String(traced.exitCode)}`;
}

/**
 * The GraphQL queries `ghWorkService` sends run to several kilobytes on one
 * line, which would bury the rest of the trace. The JSON payload keeps the
 * argument whole for anyone who needs it.
 */
export const MAX_COMMAND_LENGTH = 300;
