import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runConductorConfig } from "../../src/commands/conductorConfig.js";
import { readRounds, writeRound, writeWatch, readWatch } from "../../src/conductor/watchStore.js";

let dir: string;
let previous: string;
let out = "";
let err = "";
const file = () => join(dir, ".automata", "conductor-watch.json");

beforeEach(() => {
  previous = process.cwd();
  dir = mkdtempSync(join(tmpdir(), "conductor-config-"));
  process.chdir(dir);
  out = "";
  err = "";
  vi.spyOn(process.stdout, "write").mockImplementation((s) => ((out += String(s)), true));
  vi.spyOn(process.stderr, "write").mockImplementation((s) => ((err += String(s)), true));
});

afterEach(() => {
  vi.restoreAllMocks();
  process.chdir(previous);
  rmSync(dir, { recursive: true, force: true });
});

describe("conductor config", () => {
  it("sets a global and an item value, and list shows the effective values", () => {
    expect(runConductorConfig(["set", "copilot-review-rounds", "3"])).toBe(0);
    expect(runConductorConfig(["#12", "set", "copilot-review-rounds", "1"])).toBe(0);
    expect(JSON.parse(readFileSync(file(), "utf8")).settings).toEqual({
      global: { "copilot-review-rounds": 3 },
      items: { "12": { "copilot-review-rounds": 1 } },
    });
    out = "";
    runConductorConfig(["12", "list"]);
    expect(out).toMatch(/copilot-review-rounds\s+.*\s+1\s+item/);
    out = "";
    runConductorConfig(["list"]);
    expect(out).toMatch(/copilot-review-rounds\s+.*\s+3\s+global/);
  });

  it("get prints the effective value; unset removes one scope only", () => {
    runConductorConfig(["set", "copilot-review-rounds", "3"]);
    runConductorConfig(["7", "set", "copilot-review-rounds", "1"]);
    out = "";
    runConductorConfig(["7", "get", "copilot-review-rounds"]);
    expect(out).toBe("1\n");
    expect(runConductorConfig(["7", "unset", "copilot-review-rounds"])).toBe(0);
    out = "";
    runConductorConfig(["7", "get", "copilot-review-rounds"]);
    expect(out).toBe("3\n");
  });

  it("warns that copilot-review-type is not supported yet", () => {
    expect(runConductorConfig(["set", "copilot-review-type", "lite"])).toBe(0);
    expect(err).toMatch(/not supported yet/);
  });

  it("fails on an unknown key, a bad value and a bad verb", () => {
    expect(runConductorConfig(["set", "nope", "1"])).toBe(1);
    expect(err).toMatch(/Supported keys: .*copilot-review-rounds/);
    expect(runConductorConfig(["set", "copilot-review-rounds", "-1"])).toBe(1);
    expect(runConductorConfig(["get", "nope"])).toBe(1);
    expect(runConductorConfig(["unset", "nope"])).toBe(1);
    expect(runConductorConfig(["frobnicate"])).toBe(1);
    expect(runConductorConfig(["#0", "list"])).toBe(1);
    expect(runConductorConfig(["set", "copilot-review-rounds"])).toBe(1);
  });

  it("never creates the state file for list, get or unset of an absent key", () => {
    runConductorConfig(["list"]);
    runConductorConfig(["5", "list"]);
    runConductorConfig(["get", "copilot-review-rounds"]);
    runConductorConfig(["unset", "copilot-review-rounds"]);
    expect(existsSync(file())).toBe(false);
  });

  it("keeps the watch list and the round records when settings change, and the reverse", () => {
    writeWatch([4, 5]);
    writeRound(9, { requested: 1, headSha: "abc" });
    runConductorConfig(["set", "copilot-review-rounds", "2"]);
    expect(readWatch()).toEqual([4, 5]);
    expect(readRounds()).toEqual({ "9": { requested: 1, headSha: "abc" } });
    writeWatch([4]);
    out = "";
    runConductorConfig(["get", "copilot-review-rounds"]);
    expect(out).toBe("2\n");
  });
});
