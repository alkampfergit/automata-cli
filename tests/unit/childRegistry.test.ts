import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { trackChild, untrackChild, terminateTrackedChildren } from "../../src/cli/childRegistry.js";

/** A child that exits only when told to, so termination timing is observable. */
class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly signals: NodeJS.Signals[] = [];
  /** When set, the child ignores SIGTERM — like a wedged model process. */
  ignoreTerm = false;

  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal ?? "SIGTERM");
    if (signal === "SIGTERM" && this.ignoreTerm) return true;
    this.finish(signal ?? "SIGTERM");
    return true;
  }

  finish(signal: NodeJS.Signals): void {
    this.signalCode = signal;
    this.emit("exit", null, signal);
  }
}

function make(): { child: FakeChild; asChild: ChildProcess } {
  const child = new FakeChild();
  return { child, asChild: child as unknown as ChildProcess };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe("terminateTrackedChildren", () => {
  it("returns true immediately when nothing is tracked", async () => {
    await expect(terminateTrackedChildren()).resolves.toBe(true);
  });

  it("SIGTERMs every tracked child and confirms they exited", async () => {
    const a = make();
    const b = make();
    trackChild(a.asChild);
    trackChild(b.asChild);

    await expect(terminateTrackedChildren(1000)).resolves.toBe(true);
    expect(a.child.signals).toEqual(["SIGTERM"]);
    expect(b.child.signals).toEqual(["SIGTERM"]);

    untrackChild(a.asChild);
    untrackChild(b.asChild);
  });

  it("escalates to SIGKILL and still waits for the exit before reporting success", async () => {
    const { child, asChild } = make();
    child.ignoreTerm = true;
    trackChild(asChild);

    // SIGKILL cannot be ignored, so the fake exits on escalation.
    await expect(terminateTrackedChildren(20, 1000)).resolves.toBe(true);
    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);

    untrackChild(asChild);
  });

  it("reports false when a child cannot be confirmed dead, so the caller keeps the lock", async () => {
    // The important case: SIGKILL is asynchronous, so escalating is not the same
    // as having escalated successfully. Releasing the lock here would hand it to
    // the next tick while a model may still be running.
    const child = new (class extends FakeChild {
      override kill(signal?: NodeJS.Signals): boolean {
        this.signals.push(signal ?? "SIGTERM");
        return true; // never exits
      }
    })();
    const asChild = child as unknown as ChildProcess;
    trackChild(asChild);

    await expect(terminateTrackedChildren(20, 20)).resolves.toBe(false);
    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);

    untrackChild(asChild);
  });

  it("ignores a child that has already exited", async () => {
    const { child, asChild } = make();
    child.exitCode = 0;
    trackChild(asChild);

    await expect(terminateTrackedChildren(1000)).resolves.toBe(true);
    expect(child.signals).toEqual([]);

    untrackChild(asChild);
  });
});
