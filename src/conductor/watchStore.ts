import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readRawConfig } from "../config/configStore.js";
import { WATCH_RELATIVE_PATH } from "../run/runLock.js";
import { normalizeWatch } from "./watchList.js";
import { emptySettings, isEmptySettings, normalizeSettings, withSetting, type SettingValue, type SettingsState } from "./settings.js";
import type { RoundRecord } from "./copilotRounds.js";

/**
 * The conductor's watch list is machine state, not configuration. It lives in
 * its own gitignored file so that `conductor add`, `remove` and the tick's
 * pruning never make the tracked `.automata/config.json` dirty.
 */
function watchPath(): string {
  return join(process.cwd(), WATCH_RELATIVE_PATH);
}

const LOCK_WAIT_MS = 10_000;
const LOCK_STALE_MS = 30_000;
const LOCK_POLL_MS = 20;
let lockDepth = 0;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Remove a lock directory whose holder died: it is older than the stale limit. */
function removeStaleLock(lock: string): void {
  try {
    if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) rmSync(lock, { recursive: true, force: true });
  } catch {
    // The holder released it between the check and the removal.
  }
}

/**
 * Run a read-modify-write of the state file while holding a lock shared by every writer (`config`, `add`, `remove`,
 * the prune and the rounds), so no writer replaces another's update with an older snapshot. Re-entrant in a process.
 */
export function withStateLock<T>(action: () => T): T {
  if (lockDepth > 0) return action();
  const lock = `${watchPath()}.lock`;
  mkdirSync(dirname(lock), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      removeStaleLock(lock);
      if (Date.now() > deadline) throw new Error(`could not lock ${WATCH_RELATIVE_PATH}: another command holds it`, { cause: err });
      sleepSync(LOCK_POLL_MS);
    }
  }
  lockDepth++;
  try {
    return action();
  } finally {
    lockDepth--;
    rmSync(lock, { recursive: true, force: true });
  }
}

interface WatchState {
  watch: number[];
  stories: number[];
  settings: SettingsState;
  /** The Copilot review rounds asked for, by pull request number. */
  rounds: Record<string, RoundRecord>;
}

function normalizeRounds(raw: unknown): Record<string, RoundRecord> {
  const rounds: Record<string, RoundRecord> = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return rounds;
  for (const [id, value] of Object.entries(raw)) {
    const record = value as Partial<RoundRecord> | null;
    if (!/^[1-9]\d*$/.test(id) || typeof record !== "object" || record === null) continue;
    if (typeof record.requested !== "number" || !Number.isSafeInteger(record.requested) || record.requested < 0) continue;
    rounds[id] = {
      requested: record.requested,
      headSha: typeof record.headSha === "string" ? record.headSha : null,
      ...(typeof record.stopped === "string" ? { stopped: record.stopped } : {}),
    };
  }
  return rounds;
}

function serialize(state: WatchState): Record<string, unknown> {
  return {
    watch: state.watch,
    ...(state.stories.length > 0 ? { stories: state.stories } : {}),
    ...(isEmptySettings(state.settings) ? {} : { settings: state.settings }),
    ...(Object.keys(state.rounds).length > 0 ? { copilotRounds: state.rounds } : {}),
  };
}

function writeState(state: WatchState): void {
  mkdirSync(dirname(watchPath()), { recursive: true });
  const target = watchPath();
  // A pid is unique only within one host; a checkout can be shared across containers.
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(serialize(state), null, 2) + "\n", "utf8");
    renameSync(temp, target);
  } finally {
    try {
      unlinkSync(temp);
    } catch {
      // The rename consumed it, which is the successful path.
    }
  }
}

function emptyState(): WatchState {
  return { watch: [], stories: [], settings: emptySettings(), rounds: {} };
}

/** The file as it is: a file that cannot be read or parsed has no entries. */
function readFileState(): WatchState | null {
  if (!existsSync(watchPath())) return null;
  try {
    const parsed = JSON.parse(readFileSync(watchPath(), "utf8")) as {
      watch?: unknown;
      stories?: unknown;
      settings?: unknown;
      copilotRounds?: unknown;
    };
    return {
      watch: normalizeWatch(parsed.watch),
      stories: normalizeWatch(parsed.stories),
      settings: normalizeSettings(parsed.settings),
      rounds: normalizeRounds(parsed.copilotRounds),
    };
  } catch {
    return emptyState();
  }
}

/** Writes the watch list and keeps every other section. */
export function writeWatch(list: number[]): void {
  withStateLock(() => writeState({ ...(readFileState() ?? emptyState()), watch: list }));
}

/** Change the watch list as it is on disk right now, under the state lock. Writes nothing when it is unchanged. */
export function updateWatchList(change: (current: number[]) => number[]): void {
  withStateLock(() => {
    const current = readWatch();
    const next = change(current);
    if (next.length === current.length && next.every((id, i) => id === current[i])) return;
    writeWatch(next);
  });
}

/** The parent issues the conductor drives child by child. The same file as the watch list. */
export function readStories(): number[] {
  return readFileState()?.stories ?? [];
}

/** Writes the stories and keeps the watch list (with the one-time copy of the legacy key). */
export function writeStories(list: number[]): void {
  withStateLock(() => {
    const watch = readWatch({ migrate: false });
    writeState({ ...(readFileState() ?? emptyState()), watch, stories: list });
  });
}

/**
 * The watch list. A file that cannot be read or parsed means an empty list.
 * While the file does not exist, the entries of the old `conductor.watch`
 * config key are copied into it once; `config.json` is never rewritten, and the
 * old key is ignored once the file exists. A read-only caller passes
 * `{ migrate: false }`: it still sees the legacy entries, but writes nothing.
 */
export function readWatch(options: { migrate?: boolean } = {}): number[] {
  const state = readFileState();
  if (state !== null) return state.watch;
  const legacy = normalizeWatch(readRawConfig().conductor?.watch);
  if (legacy.length === 0 || options.migrate === false) return legacy;
  try {
    writeWatch(legacy);
  } catch (err) {
    process.stderr.write(`Warning: could not write ${WATCH_RELATIVE_PATH}: ${(err as Error).message}\n`);
  }
  return legacy;
}

/** The state to extend: the file, or a new state that keeps the entries of the legacy `conductor.watch` key. */
function stateToWrite(): WatchState {
  return readFileState() ?? { ...emptyState(), watch: normalizeWatch(readRawConfig().conductor?.watch) };
}

/** The conductor settings. Read-only: a missing file gives empty settings and is not created. */
export function readSettings(): SettingsState {
  return readFileState()?.settings ?? emptySettings();
}

/** Set (`value` given) or remove (`value` null) one setting; `id` null is the global scope. Keeps every other section. */
export function writeSetting(key: string, id: number | null, value: SettingValue | null): void {
  withStateLock(() => {
    const state = stateToWrite();
    writeState({ ...state, settings: withSetting(state.settings, key, id, value) });
  });
}

/** The Copilot review rounds recorded so far, by pull request number. Read-only. */
export function readRounds(): Record<string, RoundRecord> {
  return readFileState()?.rounds ?? {};
}

/** Record the rounds of one pull request. Keeps every other section. */
export function writeRound(pr: number, record: RoundRecord): void {
  withStateLock(() => {
    const state = stateToWrite();
    writeState({ ...state, rounds: { ...state.rounds, [String(pr)]: record } });
  });
}
