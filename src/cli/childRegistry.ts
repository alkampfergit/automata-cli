import type { ChildProcess } from "node:child_process";

/**
 * The executor children currently running, so a signal handler can stop them
 * instead of exiting and leaving a model editing and pushing while the next
 * tick picks up the freed lock.
 *
 * Shared by every executor `do-work` can spawn: a registry that covered only
 * one of them would leave the other able to outlive its parent.
 */
const active = new Set<ChildProcess>();

export function trackChild(child: ChildProcess): void {
  active.add(child);
}

export function untrackChild(child: ChildProcess): void {
  active.delete(child);
}

function waitForExit(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
  });
}

function afterDelay(ms: number): Promise<"timeout"> {
  return new Promise<"timeout">((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), ms);
    timer.unref();
  });
}

/**
 * Terminate every tracked child, and report whether they are all confirmed gone.
 *
 * The caller releases the run lock on the strength of this answer, so resolving
 * before the children have actually exited would hand the lock to the next tick
 * while a model is still running — the exact thing the registry exists to
 * prevent. `SIGKILL` is asynchronous, so escalating is not the same as having
 * escalated successfully: after killing, this keeps waiting, and returns false
 * if a child still cannot be confirmed dead.
 */
export async function terminateTrackedChildren(
  timeoutMs = 10_000,
  killGraceMs = 5_000,
): Promise<boolean> {
  const children = [...active];
  if (children.length === 0) return true;

  const exits = children.map((child) => waitForExit(child));
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }

  const settled = await Promise.race([Promise.all(exits).then(() => "exited" as const), afterDelay(timeoutMs)]);
  if (settled === "exited") return true;

  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }

  const escalated = await Promise.race([
    Promise.all(exits).then(() => "exited" as const),
    afterDelay(killGraceMs),
  ]);
  return escalated === "exited";
}
