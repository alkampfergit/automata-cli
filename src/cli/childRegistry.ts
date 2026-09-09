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

/** Terminate every tracked child and resolve once they have all exited. */
export function terminateTrackedChildren(timeoutMs = 10_000): Promise<void> {
  const children = [...active];
  if (children.length === 0) return Promise.resolve();

  const exits = children.map(
    (child) =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
      }),
  );

  return Promise.race([
    Promise.all(exits).then(() => undefined),
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        for (const child of children) child.kill("SIGKILL");
        resolve();
      }, timeoutMs);
      timer.unref();
    }),
  ]);
}
