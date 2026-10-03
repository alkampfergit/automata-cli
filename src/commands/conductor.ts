import { Command } from "commander";
import { azdoUnsupportedMessage, isExplicitGitHub } from "../remote/backend.js";
import {
  readConfig,
  readRawConfig,
  writeConfig,
  DEFAULT_DO_WORK,
  type AutomataConfig,
} from "../config/configStore.js";
import {
  applyDiscovery,
  getAuthenticatedLogin,
  getOpenPrLinkMap,
  getWatchTarget,
  type WatchTarget,
} from "../github/ghWorkService.js";
import { normalizeWatch, parseWatchId, withoutWatched, withWatched } from "../conductor/watchList.js";
import { conductorIdentityProblemFor } from "../github/identity.js";
import { acquireConductorLock, CONDUCTOR_LOCK_RELATIVE_PATH } from "../run/runLock.js";

function fail(message: string): number {
  process.stderr.write(`Error: ${message}\n`);
  return 1;
}

/**
 * Apply a change to the watch list against the config as it is on disk right
 * now, so a concurrent `add`/`remove`/prune is not overwritten by a stale
 * snapshot taken earlier in the command (the network calls in between are slow).
 */
function updateWatch(change: (current: number[]) => number[]): void {
  const raw = readRawConfig();
  const current = normalizeWatch(raw.conductor?.watch);
  const next = change(current);
  if (next.length === current.length && next.every((id, i) => id === current[i])) return;
  writeConfig({ ...raw, conductor: { ...raw.conductor, watch: next } });
}

function describe(target: WatchTarget): string {
  return `${target.kind === "pr" ? "PR" : "issue"} #${String(target.number)} (${target.state}): ${target.title}`;
}

/**
 * Drop closed issues and closed/merged pull requests from `conductor.watch`,
 * logging each removal. An id that cannot be looked up stays: a network error
 * must not empty the list.
 */
export function pruneWatchList(config: AutomataConfig): void {
  const watch = normalizeWatch(config.conductor?.watch);
  const dropped: number[] = [];
  for (const id of watch) {
    try {
      const target = getWatchTarget(id);
      if (target.state === "closed") {
        process.stdout.write(
          `Conductor: dropped ${target.kind === "pr" ? "PR" : "issue"} #${String(id)} from the watch list (closed).\n`,
        );
        dropped.push(id);
      }
    } catch (err) {
      process.stderr.write(`Warning: could not check #${String(id)}, keeping it watched: ${(err as Error).message}\n`);
    }
  }
  if (dropped.length > 0) updateWatch((current) => current.filter((id) => !dropped.includes(id)));
}

/** Config shared by `add` and `list`: GitHub mode and a discovery setting that can be applied. */
function loadGitHubConfig(): AutomataConfig | number {
  const config = readRawConfig();
  if (!isExplicitGitHub(config)) {
    return fail(
      azdoUnsupportedMessage(
        "conductor",
        "It needs the GitHub APIs; set the remote with `automata config set type gh`.",
      ),
    );
  }
  return config;
}

export function runWatchAdd(rawId: string): number {
  const id = parseWatchId(rawId);
  if (id === null) return fail(`"${rawId}" is not an issue or pull request number.`);
  const config = loadGitHubConfig();
  if (typeof config === "number") return config;
  const technique = config.issueDiscoveryTechnique;
  if (!technique) return fail("No issue discovery technique configured. Run `automata config`.");
  const value = (config.issueDiscoveryValue ?? "").trim();
  if (technique !== "title-contains" && value.length === 0) {
    return fail("No issue discovery value configured. Run `automata config`.");
  }
  try {
    const target = getWatchTarget(id);
    if (target.state === "closed") return fail(`${describe(target)} is closed; nothing to watch.`);
    // Resolve the linked PRs first: a failure here must leave GitHub untouched.
    const followed =
      target.kind === "issue"
        ? (getOpenPrLinkMap().byIssue.get(id) ?? []).map((pr) => pr.number)
        : [];
    applyDiscovery(target, technique, value);
    updateWatch((current) => withWatched(current, id, ...followed));
    process.stdout.write(`Watching ${describe(target)}.\n`);
    for (const pr of followed) process.stdout.write(`Also following linked PR #${String(pr)}.\n`);
    return 0;
  } catch (err) {
    return fail((err as Error).message);
  }
}

export function runWatchRemove(rawId: string): number {
  const id = parseWatchId(rawId);
  if (id === null) return fail(`"${rawId}" is not an issue or pull request number.`);
  const before = normalizeWatch(readRawConfig().conductor?.watch);
  if (!before.includes(id)) return fail(`#${String(id)} is not on the watch list.`);
  updateWatch((current) => withoutWatched(current, id));
  process.stdout.write(`Stopped watching #${String(id)}.\n`);
  return 0;
}

export function runWatchList(): number {
  const config = loadGitHubConfig();
  if (typeof config === "number") return config;
  const watch = normalizeWatch(config.conductor?.watch);
  if (watch.length === 0) {
    process.stdout.write("The watch list is empty.\n");
    return 0;
  }
  for (const id of watch) {
    try {
      process.stdout.write(`${describe(getWatchTarget(id))}\n`);
    } catch (err) {
      process.stdout.write(`#${String(id)}: unavailable (${(err as Error).message})\n`);
    }
  }
  return 0;
}

function exitWith(code: number): void {
  if (code !== 0) process.exit(code);
}

/**
 * One conductor tick. Returns the exit code rather than exiting, so the lock is
 * always released on the way out.
 *
 * Only the pre-flight exists so far: configuration, the identity check and the
 * lock. The conductor's actual work is added by the later issues of the epic.
 */
export function runConductor(): number {
  let config;
  try {
    config = readConfig();
  } catch (err) {
    return fail((err as Error).message);
  }

  if (!isExplicitGitHub(config)) {
    return fail(
      azdoUnsupportedMessage(
        "conductor",
        "It needs the GitHub APIs; set the remote with `automata config set type gh`.",
      ),
    );
  }

  const allowedUsers = (config.allowedUsers ?? []).filter((user) => user.trim().length > 0);
  if (allowedUsers.length === 0) {
    return fail("No allowed users configured. Run `automata config set allowed-users <user1,user2>`.");
  }
  const agentUser = (config.agentUser ?? "").trim();
  if (agentUser.length === 0) {
    return fail("No agent user configured. Run `automata config set agent-user <login>`.");
  }

  let login: string | null;
  try {
    login = getAuthenticatedLogin();
  } catch (err) {
    return fail(`\`gh\` could not be queried: ${(err as Error).message}`);
  }
  const problem = conductorIdentityProblemFor(login, agentUser, allowedUsers);
  if (problem !== null) return fail(problem);

  // Hand-edited JSON: apply the same rule `do-work` does (a positive safe integer).
  const rawStale: unknown = config.doWork?.lockStaleMinutes;
  if (rawStale !== undefined && rawStale !== null) {
    if (typeof rawStale !== "number" || !Number.isSafeInteger(rawStale) || rawStale < 1) {
      return fail(`doWork.lockStaleMinutes must be a positive integer, got ${JSON.stringify(rawStale)}.`);
    }
  }
  const staleMinutes = config.doWork?.lockStaleMinutes ?? DEFAULT_DO_WORK.lockStaleMinutes;
  const lock = acquireConductorLock(staleMinutes);
  if (!lock.ok) {
    const held = lock.heldBy;
    process.stdout.write(
      `Another conductor is already running here (pid ${String(held.pid)} on ${held.host}, ` +
        `started ${held.startedAt}). Doing nothing.\n`,
    );
    if (lock.suspect) {
      process.stderr.write(
        `Warning: that lock has been held longer than ${String(staleMinutes)} minutes. If no tick is really ` +
          `running, its process id was probably reused; remove ${CONDUCTOR_LOCK_RELATIVE_PATH} once you have confirmed that.\n`,
      );
      return 2;
    }
    return 0;
  }

  try {
    process.stdout.write(`Conductor: running as ${login ?? ""}.\n`);
    pruneWatchList(config);
    return 0;
  } finally {
    lock.handle.release();
  }
}

export const conductorCommand = new Command("conductor")
  .description(
    "Run one conductor tick as an allowed (human) account: verify the identity, take the conductor's own run lock, then act",
  )
  .action(() => {
    exitWith(runConductor());
  });

conductorCommand
  .command("add <id>")
  .description("Watch an issue or pull request and make do-work pick it up (an issue also follows its linked PR)")
  .action((id: string) => {
    exitWith(runWatchAdd(id));
  });

conductorCommand
  .command("remove <id>")
  .description("Stop watching an issue or pull request (the discovery label/assignee is left alone)")
  .action((id: string) => {
    exitWith(runWatchRemove(id));
  });

conductorCommand
  .command("list")
  .description("List the watched issues and pull requests")
  .action(() => {
    exitWith(runWatchList());
  });
