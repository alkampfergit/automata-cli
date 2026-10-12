/**
 * `conductor --automatic`: the tick, again and again, in the foreground. Each
 * iteration is a whole tick with its own lock, so the loop adds no state of its own.
 */

export const DEFAULT_INTERVAL_SECONDS = 60;

/** The reason `--interval` is unusable, or the number of seconds. */
export function parseInterval(raw: string | undefined): number | string {
  if (raw === undefined) return DEFAULT_INTERVAL_SECONDS;
  if (!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) {
    return `--interval must be a positive whole number of seconds, got "${raw}".`;
  }
  return Number(raw);
}

/** What one tick tells the loop. `open` is the watch list length after the prune; null when the tick did not get that far. */
export interface TickResult {
  code: number;
  open: number | null;
}

export interface AutomaticLoop {
  tick: () => Promise<TickResult>;
  /** Wait; resolves early (and false) when the loop is told to stop. */
  sleep: (seconds: number) => Promise<void>;
  stopped: () => boolean;
  log: (line: string) => void;
  intervalSeconds: number;
}

/**
 * Run ticks until nothing is watched (exit 0) or the loop is stopped (exit 0 too:
 * stopping is what the operator asked for). A failed tick is logged and retried.
 */
export async function runAutomatic(loop: AutomaticLoop): Promise<number> {
  while (!loop.stopped()) {
    const result = await loop.tick();
    if (result.open === 0) {
      loop.log("Conductor: no open item is watched any more; leaving the loop.");
      return 0;
    }
    if (loop.stopped()) break;
    if (result.code !== 0) loop.log(`Conductor: the tick ended with exit code ${String(result.code)}; the next tick runs anyway.`);
    loop.log(`Conductor: next tick in ${String(loop.intervalSeconds)} s.`);
    await loop.sleep(loop.intervalSeconds);
  }
  loop.log("Conductor: stopped.");
  return 0;
}
