import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockTarget = vi.fn();
const mockLinks = vi.fn();
const mockApply = vi.fn();

vi.mock("../../src/github/ghWorkService.js", () => ({
  getWatchTarget: (...a: unknown[]) => mockTarget(...a),
  getOpenPrLinkMap: (...a: unknown[]) => mockLinks(...a),
  applyDiscovery: (...a: unknown[]) => mockApply(...a),
}));

import { readWatch, writeWatch } from "../../src/conductor/watchStore.js";
import { pruneWatchList, runWatchAdd, runWatchRemove } from "../../src/commands/conductor.js";

let dir: string;
let previous: string;

const watchFile = () => join(dir, ".automata", "conductor-watch.json");
const configFile = () => join(dir, ".automata", "config.json");

function writeConfigFile(config: object): string {
  mkdirSync(join(dir, ".automata"), { recursive: true });
  const text = JSON.stringify(config, null, 2) + "\n";
  writeFileSync(configFile(), text, "utf8");
  return text;
}

beforeEach(() => {
  previous = process.cwd();
  dir = mkdtempSync(join(tmpdir(), "watch-store-"));
  process.chdir(dir);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  process.chdir(previous);
  vi.restoreAllMocks();
  vi.clearAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("watch store", () => {
  it("returns an empty list, and creates no file, when the file is missing", () => {
    expect(readWatch()).toEqual([]);
    expect(existsSync(watchFile())).toBe(false);
  });

  it("round-trips the list and drops bad entries", () => {
    writeWatch([114, 120]);
    expect(JSON.parse(readFileSync(watchFile(), "utf8"))).toEqual({ watch: [114, 120] });
    writeFileSync(watchFile(), JSON.stringify({ watch: [3, "x", -1, 3, 4] }), "utf8");
    expect(readWatch()).toEqual([3, 4]);
  });

  it("returns an empty list for a file that is not valid JSON", () => {
    mkdirSync(join(dir, ".automata"));
    writeFileSync(watchFile(), "{ not json", "utf8");
    expect(readWatch()).toEqual([]);
  });

  it("returns an empty list for a file that cannot be read, and does not migrate", () => {
    writeConfigFile({ conductor: { watch: [9] } });
    // A directory in the place of the file: it exists but reading it fails, even for root.
    mkdirSync(watchFile());
    expect(readWatch()).toEqual([]);
  });

  it("returns an empty list for a file without read permission", () => {
    mkdirSync(join(dir, ".automata"));
    writeFileSync(watchFile(), JSON.stringify({ watch: [1] }), "utf8");
    chmodSync(watchFile(), 0o000);
    try {
      // Root can read the file anyway; either result is a valid list, never an exception.
      expect([[], [1]]).toContainEqual(readWatch());
    } finally {
      chmodSync(watchFile(), 0o600);
    }
  });

  it("migrates conductor.watch once when the file does not exist, without touching config.json", () => {
    const before = writeConfigFile({ allowedUsers: ["a"], conductor: { watch: [7, 8], maxRepliesPerItem: 2 } });
    expect(readWatch()).toEqual([7, 8]);
    expect(JSON.parse(readFileSync(watchFile(), "utf8"))).toEqual({ watch: [7, 8] });
    expect(readFileSync(configFile(), "utf8")).toBe(before);
  });

  it("ignores the old key once the file exists", () => {
    writeConfigFile({ conductor: { watch: [7, 8] } });
    writeWatch([8]);
    expect(readWatch()).toEqual([8]);
    writeWatch([]);
    expect(readWatch()).toEqual([]);
  });

  it("does not create the file when there is nothing to migrate", () => {
    writeConfigFile({ conductor: { watch: [] } });
    expect(readWatch()).toEqual([]);
    expect(existsSync(watchFile())).toBe(false);
  });
});

describe("watch commands leave config.json alone", () => {
  const open = (n: number) => ({ number: n, kind: "issue", state: "open", title: `T${String(n)}`, labels: [] as string[] });
  const closed = (n: number) => ({ ...open(n), state: "closed" });

  it("add, remove and the prune write only the watch file", async () => {
    const before = writeConfigFile({
      remoteType: "gh",
      issueDiscoveryTechnique: "label",
      issueDiscoveryValue: "automata",
      conductor: { watch: [1], maxRepliesPerItem: 3 },
    });
    mockLinks.mockReturnValue({ byIssue: new Map() });
    mockTarget.mockImplementation((n: number) => open(n));

    expect(await runWatchAdd("2")).toBe(0);
    expect(JSON.parse(readFileSync(watchFile(), "utf8"))).toEqual({ watch: [1, 2] });
    expect(await runWatchAdd("3")).toBe(0);
    mockTarget.mockImplementation((n: number) => (n === 2 ? closed(2) : open(n)));
    expect(pruneWatchList()).toEqual([1, 3]);
    expect(JSON.parse(readFileSync(watchFile(), "utf8"))).toEqual({ watch: [1, 3] });
    expect(runWatchRemove("1")).toBe(0);
    expect(JSON.parse(readFileSync(watchFile(), "utf8"))).toEqual({ watch: [3] });

    expect(readFileSync(configFile(), "utf8")).toBe(before);
  });
});
