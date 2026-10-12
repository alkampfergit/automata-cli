import { describe, it, expect, vi } from "vitest";
import { parseInterval, runAutomatic, type TickResult } from "../../src/conductor/automatic.js";

describe("parseInterval", () => {
  it("defaults to 60 and accepts a positive whole number", () => {
    expect(parseInterval(undefined)).toBe(60);
    expect(parseInterval("5")).toBe(5);
  });
  it.each(["0", "-3", "1.5", "abc", ""])("rejects %j", (raw) => {
    expect(parseInterval(raw)).toMatch(/--interval must be a positive whole number/);
  });
});

describe("runAutomatic", () => {
  function loop(results: TickResult[], stopAfter = Infinity) {
    const ticks = vi.fn(() => Promise.resolve(results.shift() ?? { code: 0, open: 0 }));
    const sleep = vi.fn(() => Promise.resolve());
    const log = vi.fn();
    return { ticks, sleep, log, options: { tick: ticks, sleep, log, intervalSeconds: 7, stopped: () => ticks.mock.calls.length >= stopAfter } };
  }

  it("leaves at once when nothing is watched at the start", async () => {
    const l = loop([{ code: 0, open: 0 }]);
    expect(await runAutomatic(l.options)).toBe(0);
    expect(l.ticks).toHaveBeenCalledOnce();
    expect(l.sleep).not.toHaveBeenCalled();
  });

  it("goes on after a failed tick and waits the interval", async () => {
    const l = loop([{ code: 1, open: 2 }, { code: 0, open: 1 }, { code: 0, open: 0 }]);
    expect(await runAutomatic(l.options)).toBe(0);
    expect(l.ticks).toHaveBeenCalledTimes(3);
    expect(l.sleep).toHaveBeenCalledWith(7);
    expect(l.log).toHaveBeenCalledWith(expect.stringContaining("exit code 1"));
  });

  it("goes on when a tick could not count the list", async () => {
    const l = loop([{ code: 0, open: null }, { code: 0, open: 0 }]);
    await runAutomatic(l.options);
    expect(l.ticks).toHaveBeenCalledTimes(2);
  });

  it("stops after the current tick when told to", async () => {
    const l = loop([{ code: 0, open: 3 }, { code: 0, open: 3 }], 1);
    expect(await runAutomatic(l.options)).toBe(0);
    expect(l.ticks).toHaveBeenCalledOnce();
    expect(l.sleep).not.toHaveBeenCalled();
  });
});
