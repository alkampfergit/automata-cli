import { Command } from "commander";
import { azdoUnsupportedMessage, isExplicitGitHub } from "../remote/backend.js";
import { readConfig, DEFAULT_DO_WORK } from "../config/configStore.js";
import { getAuthenticatedLogin } from "../github/ghWorkService.js";
import { conductorIdentityProblemFor } from "../github/identity.js";
import { acquireConductorLock, CONDUCTOR_LOCK_RELATIVE_PATH } from "../run/runLock.js";

function fail(message: string): number {
  process.stderr.write(`Error: ${message}\n`);
  return 1;
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
    process.stdout.write(`Conductor: running as ${login ?? ""}. Nothing to do yet.\n`);
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
    const exitCode = runConductor();
    if (exitCode !== 0) process.exit(exitCode);
  });
