import { describe, expect, it } from "vitest";
import { checkAzdoPrerequisites, compareVersions, parseVersion } from "../../src/remote/azdoPrerequisites.js";

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
    expect(compareVersions([0, 20, 0], [0, 5, 0])).toBe(1);
    expect(parseVersion("nope")).toBeNull();
  });
});
