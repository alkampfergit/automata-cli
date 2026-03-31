import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Unit tests for publish-release service functions ─────────────────────────

const mockSpawnSync = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
  };
});

describe("gitService.bumpMinorVersion", () => {
  it("increments minor and resets patch", async () => {
    const { bumpMinorVersion } = await import("../../src/git/gitService.js");
    expect(bumpMinorVersion("1.2.5")).toBe("1.3.0");
  });

  it("handles zero patch", async () => {
    const { bumpMinorVersion } = await import("../../src/git/gitService.js");
    expect(bumpMinorVersion("2.0.0")).toBe("2.1.0");
  });

  it("handles v-prefixed version", async () => {
    const { bumpMinorVersion } = await import("../../src/git/gitService.js");
    expect(bumpMinorVersion("v2.0.5")).toBe("2.1.0");
  });

  it("throws on invalid semver", async () => {
    const { bumpMinorVersion } = await import("../../src/git/gitService.js");
    expect(() => bumpMinorVersion("notaversion")).toThrow("Invalid semver");
  });
});

describe("gitService.getLatestTagOnMaster", () => {
  beforeEach(() => mockSpawnSync.mockReset());
  afterEach(() => vi.resetModules());

  it("returns bare semver from git describe output", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "1.2.0\n", stderr: "", status: 0 });
    const { getLatestTagOnMaster } = await import("../../src/git/gitService.js");
    expect(getLatestTagOnMaster()).toBe("1.2.0");
  });

  it("strips v prefix", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "v3.4.5\n", stderr: "", status: 0 });
    const { getLatestTagOnMaster } = await import("../../src/git/gitService.js");
    expect(getLatestTagOnMaster()).toBe("3.4.5");
  });

  it("returns null when git describe fails", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "fatal: No names found", status: 128 });
    const { getLatestTagOnMaster } = await import("../../src/git/gitService.js");
    expect(getLatestTagOnMaster()).toBeNull();
  });

  it("returns null when tag is not valid semver", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "some-non-semver-tag\n", stderr: "", status: 0 });
    const { getLatestTagOnMaster } = await import("../../src/git/gitService.js");
    expect(getLatestTagOnMaster()).toBeNull();
  });
});

describe("gitService.tagExists", () => {
  beforeEach(() => mockSpawnSync.mockReset());
  afterEach(() => vi.resetModules());

  it("returns true when git tag -l returns the tag", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "1.3.0\n", stderr: "", status: 0 });
    const { tagExists } = await import("../../src/git/gitService.js");
    expect(tagExists("1.3.0")).toBe(true);
  });

  it("returns false when git tag -l returns empty output", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "", status: 0 });
    const { tagExists } = await import("../../src/git/gitService.js");
    expect(tagExists("1.3.0")).toBe(false);
  });

  it("throws when git tag -l exits non-zero", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "not a git repository", status: 128 });
    const { tagExists } = await import("../../src/git/gitService.js");
    expect(() => tagExists("1.3.0")).toThrow("git tag -l 1.3.0");
  });
});

describe("gitService.publishRelease", () => {
  beforeEach(() => mockSpawnSync.mockReset());
  afterEach(() => vi.resetModules());

  it("executes the 8-step GitFlow sequence in order", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "", status: 0 });
    const { publishRelease } = await import("../../src/git/gitService.js");
    publishRelease("1.3.0", false);

    const calls = mockSpawnSync.mock.calls.map((c) => (c as [string, string[]])[1].join(" "));
    expect(calls).toEqual([
      "checkout -b release/1.3.0",
      "checkout master",
      "merge --no-ff release/1.3.0",
      "tag 1.3.0",
      "checkout develop",
      "merge --no-ff release/1.3.0",
      "branch -d release/1.3.0",
      "push origin develop master 1.3.0",
    ]);
  });

  it("throws with descriptive error when a step fails", async () => {
    mockSpawnSync
      .mockReturnValueOnce({ stdout: "", stderr: "", status: 0 }) // checkout -b
      .mockReturnValueOnce({ stdout: "", stderr: "", status: 0 }) // checkout master
      .mockReturnValueOnce({ stdout: "", stderr: "CONFLICT (content)", status: 1 }); // merge fails
    const { publishRelease } = await import("../../src/git/gitService.js");
    expect(() => publishRelease("1.3.0", false)).toThrow("CONFLICT (content)");
  });

  it("prints dry-run lines without calling spawnSync for git steps", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const { publishRelease } = await import("../../src/git/gitService.js");
    publishRelease("1.3.0", true);

    expect(mockSpawnSync).not.toHaveBeenCalled();
    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("[dry-run] git checkout -b release/1.3.0");
    expect(output).toContain("[dry-run] git push origin develop master 1.3.0");
    writeSpy.mockRestore();
  });
});
