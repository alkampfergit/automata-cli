import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertAzdoReady,
  checkAzdoPrerequisites,
  compareVersions,
  parseVersion,
  resetAzdoReadyCache,
} from "../../src/remote/azdoPrerequisites.js";

const ok = (stdout: string) => ({ stdout, stderr: "", status: 0 });

describe("checkAzdoPrerequisites", () => {
  it("reports a missing binary", () => {
    const r = checkAzdoPrerequisites(() => ({ stdout: "", stderr: "", status: 1, missing: true }));
    expect(r).toMatchObject({ ok: false, reason: "missing" });
  });
  it("rejects versions below 0.20.0", () => {
    const r = checkAzdoPrerequisites(() => ok("0.19.9\n"));
    expect(r).toMatchObject({ ok: false, reason: "too-old" });
  });
  it("reports unauthenticated when diagnose has no identity", () => {
    const r = checkAzdoPrerequisites((args) => (args[0] === "--version" ? ok("0.20.0") : ok("{}")));
    expect(r).toMatchObject({ ok: false, reason: "unauthenticated" });
  });
  it("passes and always sends --no-update-check", () => {
    const calls: string[][] = [];
    const r = checkAzdoPrerequisites((args) => {
      calls.push(args);
      return args[0] === "--version" ? ok("azdo 0.20.1") : ok('{"identity":{"displayName":"Ann"}}');
    });
    expect(r).toEqual({ ok: true, version: "0.20.1", identity: "Ann" });
    expect(calls.every((c) => c.includes("--no-update-check"))).toBe(true);
    expect(calls[1]).toEqual(["auth", "diagnose", "--json", "--no-update-check"]);
  });
  it("compares versions", () => {
    const v = (text: string) => parseVersion(text) as NonNullable<ReturnType<typeof parseVersion>>;
    expect(compareVersions(v("0.20.0"), v("0.5.0"))).toBe(1);
    expect(compareVersions(v("0.20.0-beta.1"), v("0.20.0"))).toBe(-1);
    expect(compareVersions(v("0.20.0"), v("0.20.0"))).toBe(0);
    expect(parseVersion("nope")).toBeNull();
  });
  it("rejects a prerelease of the minimum version", () => {
    const r = checkAzdoPrerequisites(() => ok("0.20.0-beta.1\n"));
    expect(r).toMatchObject({ ok: false, reason: "too-old" });
  });
});

describe("assertAzdoReady", () => {
  const good = (args: string[]) =>
    args[0] === "--version"
      ? { stdout: "0.20.0\n", stderr: "", status: 0 }
      : { stdout: JSON.stringify({ identity: "Ada" }), stderr: "", status: 0 };

  beforeEach(() => resetAzdoReadyCache());

  it("throws the failing check's message", () => {
    const run = () => ({ stdout: "", stderr: "", status: 1, missing: true });
    expect(() => assertAzdoReady(run)).toThrow("not installed");
  });

  it("probes once after a success, then trusts the result", () => {
    const run = vi.fn(good);
    assertAzdoReady(run);
    assertAzdoReady(run);
    expect(run).toHaveBeenCalledTimes(2); // --version and auth diagnose, first call only
  });

  it("re-probes after a failure", () => {
    const bad = () => ({ stdout: "0.5.0", stderr: "", status: 0 });
    expect(() => assertAzdoReady(bad)).toThrow("too old");
    expect(() => assertAzdoReady(good)).not.toThrow();
  });
});
