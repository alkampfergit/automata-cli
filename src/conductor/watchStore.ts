import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readRawConfig } from "../config/configStore.js";
import { WATCH_RELATIVE_PATH } from "../run/runLock.js";
import { normalizeWatch } from "./watchList.js";

/**
 * The conductor's watch list is machine state, not configuration. It lives in
 * its own gitignored file so that `conductor add`, `remove` and the tick's
 * pruning never make the tracked `.automata/config.json` dirty.
 */
function watchPath(): string {
  return join(process.cwd(), WATCH_RELATIVE_PATH);
}

interface WatchState {
  watch: number[];
  stories: number[];
}

function writeState(state: WatchState): void {
  mkdirSync(dirname(watchPath()), { recursive: true });
  const target = watchPath();
  // A pid is unique only within one host; a checkout can be shared across containers.
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(state.stories.length > 0 ? state : { watch: state.watch }, null, 2) + "\n", "utf8");
    renameSync(temp, target);
  } finally {
    try {
      unlinkSync(temp);
    } catch {
      // The rename consumed it, which is the successful path.
    }
  }
}

/** The file as it is: a file that cannot be read or parsed has no entries. */
function readFileState(): WatchState | null {
  if (!existsSync(watchPath())) return null;
  try {
    const parsed = JSON.parse(readFileSync(watchPath(), "utf8")) as { watch?: unknown; stories?: unknown };
    return { watch: normalizeWatch(parsed.watch), stories: normalizeWatch(parsed.stories) };
  } catch {
    return { watch: [], stories: [] };
  }
}

/** Writes the watch list and keeps the stories. */
export function writeWatch(list: number[]): void {
  writeState({ watch: list, stories: readFileState()?.stories ?? [] });
}

/** The parent issues the conductor drives child by child. The same file as the watch list. */
export function readStories(): number[] {
  return readFileState()?.stories ?? [];
}

/** Writes the stories and keeps the watch list (with the one-time copy of the legacy key). */
export function writeStories(list: number[]): void {
  writeState({ watch: readWatch({ migrate: false }), stories: list });
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
