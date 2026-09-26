import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Unit tests for publish-release service functions ─────────────────────────

const mockSpawnSync = vi.fn();
const mockReadConfig = vi.fn(() => ({}) as Record<string, unknown>);
const mockReadRawConfig = vi.fn(() => ({}) as Record<string, unknown>);

vi.mock("../../src/config/configStore.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config/configStore.js")>();
  return {
    ...actual,
    readConfig: () => mockReadConfig(),
    readRawConfig: () => mockReadRawConfig(),
  };
});

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

describe("gitService.getLatestTagOnTrunk", () => {
  beforeEach(() => mockSpawnSync.mockReset());
  afterEach(() => vi.resetModules());

  it("returns bare semver from git describe output", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "1.2.0\n", stderr: "", status: 0 });
    const { getLatestTagOnTrunk } = await import("../../src/git/gitService.js");
    expect(getLatestTagOnTrunk("origin/main")).toBe("1.2.0");
  });

  it("describes the ref it was given, not a hardcoded branch", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "1.2.0\n", stderr: "", status: 0 });
    const { getLatestTagOnTrunk } = await import("../../src/git/gitService.js");
    getLatestTagOnTrunk("origin/main");
    const args = (mockSpawnSync.mock.calls[0] as [string, string[]])[1];
    expect(args[0]).toBe("describe");
    expect(args.at(-1)).toBe("origin/main");
    expect(args).not.toContain("master");
  });

  it("strips v prefix", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "v3.4.5\n", stderr: "", status: 0 });
    const { getLatestTagOnTrunk } = await import("../../src/git/gitService.js");
    expect(getLatestTagOnTrunk("origin/master")).toBe("3.4.5");
  });

  it("returns null when git describe fails", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "fatal: No names found", status: 128 });
    const { getLatestTagOnTrunk } = await import("../../src/git/gitService.js");
    expect(getLatestTagOnTrunk("origin/main")).toBeNull();
  });

  it("returns null when tag is not valid semver", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "some-non-semver-tag\n", stderr: "", status: 0 });
    const { getLatestTagOnTrunk } = await import("../../src/git/gitService.js");
    expect(getLatestTagOnTrunk("origin/main")).toBeNull();
  });
});

describe("gitService.resolveTrunkBranch", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
    mockReadConfig.mockReset();
    mockReadConfig.mockReturnValue({});
    mockReadRawConfig.mockReset();
    mockReadRawConfig.mockReturnValue({});
  });
  afterEach(() => vi.resetModules());

  it("uses the configured branch and runs no git command", async () => {
    mockReadRawConfig.mockReturnValue({ git: { trunkBranch: "trunk" } });
    const { resolveTrunkBranch } = await import("../../src/git/gitService.js");
    expect(resolveTrunkBranch()).toEqual({ ok: true, branch: "trunk", source: "config" });
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it("reads the raw config, so an unrelated missing prompt file cannot block it", async () => {
    // `readConfig()` resolves every prompt reference and throws when one is
    // missing. Release publishing reads none of those prompts, so a stale
    // `doWork.prompts` path must not stop the trunk from resolving.
    mockReadConfig.mockImplementation(() => {
      throw new Error("Prompt file not found: .automata/missing.md");
    });
    mockReadRawConfig.mockReturnValue({ git: { trunkBranch: "trunk" } });
    const { resolveTrunkBranch } = await import("../../src/git/gitService.js");
    expect(resolveTrunkBranch()).toEqual({ ok: true, branch: "trunk", source: "config" });
    expect(mockReadConfig).not.toHaveBeenCalled();
  });

  it("ignores a blank configured branch and falls back to detection", async () => {
    mockReadRawConfig.mockReturnValue({ git: { trunkBranch: "   " } });
    mockSpawnSync.mockReturnValue({ stdout: "refs/remotes/origin/main\n", stderr: "", status: 0 });
    const { resolveTrunkBranch } = await import("../../src/git/gitService.js");
    expect(resolveTrunkBranch()).toEqual({ ok: true, branch: "main", source: "origin-head" });
  });

  it("reads origin/HEAD first", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "refs/remotes/origin/master\n", stderr: "", status: 0 });
    const { resolveTrunkBranch } = await import("../../src/git/gitService.js");
    expect(resolveTrunkBranch()).toEqual({ ok: true, branch: "master", source: "origin-head" });
    const calls = mockSpawnSync.mock.calls.map((c) => (c as [string, string[]])[1].join(" "));
    expect(calls).toEqual(["symbolic-ref --quiet refs/remotes/origin/HEAD"]);
  });

  it("falls back to ls-remote --symref when origin/HEAD is absent", async () => {
    mockSpawnSync
      .mockReturnValueOnce({ stdout: "", stderr: "", status: 1 }) // symbolic-ref
      .mockReturnValueOnce({
        stdout: "ref: refs/heads/master\tHEAD\n0f0dba2\tHEAD\n",
        stderr: "",
        status: 0,
      });
    const { resolveTrunkBranch } = await import("../../src/git/gitService.js");
    expect(resolveTrunkBranch()).toEqual({ ok: true, branch: "master", source: "ls-remote" });
  });

  it("probes main then master when neither HEAD source answers", async () => {
    mockSpawnSync
      .mockReturnValueOnce({ stdout: "", stderr: "", status: 1 }) // symbolic-ref
      .mockReturnValueOnce({ stdout: "", stderr: "", status: 0 }) // ls-remote --symref, no ref line
      .mockReturnValueOnce({ stdout: "", stderr: "", status: 2 }) // ls-remote --heads main → absent
      .mockReturnValueOnce({ stdout: "abc\trefs/heads/master\n", stderr: "", status: 0 });
    const { resolveTrunkBranch } = await import("../../src/git/gitService.js");
    expect(resolveTrunkBranch()).toEqual({ ok: true, branch: "master", source: "probe" });
  });

  it("reports every candidate it tried when nothing resolves", async () => {
    mockSpawnSync
      .mockReturnValueOnce({ stdout: "", stderr: "", status: 1 })
      .mockReturnValueOnce({ stdout: "", stderr: "", status: 0 })
      .mockReturnValue({ stdout: "", stderr: "", status: 2 });
    const { resolveTrunkBranch } = await import("../../src/git/gitService.js");
    expect(resolveTrunkBranch()).toEqual({
      ok: false,
      attempted: ["origin/HEAD", "git ls-remote --symref origin HEAD", "origin/main", "origin/master"],
    });
  });
});

describe("gitService.fetchTrunkAndTags", () => {
  beforeEach(() => mockSpawnSync.mockReset());
  afterEach(() => vi.resetModules());

  it("fetches tags with an explicit refspec so a single-branch clone gets the ref", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "", status: 0 });
    const { fetchTrunkAndTags } = await import("../../src/git/gitService.js");
    expect(fetchTrunkAndTags("main")).toEqual({ ok: true });
    const args = (mockSpawnSync.mock.calls[0] as [string, string[]])[1];
    expect(args).toEqual(["fetch", "--tags", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
  });

  it("carries git's stderr when the fetch fails", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "fatal: could not read from remote\n", status: 128 });
    const { fetchTrunkAndTags } = await import("../../src/git/gitService.js");
    expect(fetchTrunkAndTags("main")).toEqual({
      ok: false,
      message: "fatal: could not read from remote",
    });
  });
});

describe("gitService.trunkBehindCount", () => {
  beforeEach(() => mockSpawnSync.mockReset());
  afterEach(() => vi.resetModules());

  it("returns 0 without asking rev-list when there is no local branch", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "", status: 1 }); // rev-parse --verify
    const { trunkBehindCount } = await import("../../src/git/gitService.js");
    expect(trunkBehindCount("master")).toBe(0);
    expect(mockSpawnSync).toHaveBeenCalledTimes(1);
  });

  it("counts commits the local branch is missing", async () => {
    mockSpawnSync
      .mockReturnValueOnce({ stdout: "0f0dba2\n", stderr: "", status: 0 }) // rev-parse --verify
      .mockReturnValueOnce({ stdout: "3\n", stderr: "", status: 0 });
    const { trunkBehindCount } = await import("../../src/git/gitService.js");
    expect(trunkBehindCount("master")).toBe(3);
    const args = (mockSpawnSync.mock.calls[1] as [string, string[]])[1];
    expect(args).toEqual(["rev-list", "--count", "refs/heads/master..refs/remotes/origin/master"]);
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

  it("executes the 8-step GitFlow sequence in order against the resolved trunk", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "", status: 0 }); // incl. rev-parse → exists
    const { publishRelease } = await import("../../src/git/gitService.js");
    publishRelease("1.3.0", false, "main", "gitflow");

    const calls = mockSpawnSync.mock.calls
      .map((c) => (c as [string, string[]])[1].join(" "))
      .filter((c) => !c.startsWith("rev-parse"));
    expect(calls).toEqual([
      "checkout -b release/1.3.0",
      "checkout main",
      "merge --no-ff release/1.3.0",
      "tag 1.3.0",
      "checkout develop",
      "merge --no-ff release/1.3.0",
      "branch -d release/1.3.0",
      "push origin develop main 1.3.0",
    ]);
  });

  it("creates the local trunk from origin when it is missing, without --track", async () => {
    // Dispatches on argv rather than on call order, so the assertion survives a
    // step being added. `args` is optional because vitest's own teardown reaches
    // the mocked `spawnSync` once, with no arguments.
    mockSpawnSync.mockImplementation((_cmd?: string, args?: string[]) =>
      args?.[0] === "rev-parse"
        ? { stdout: "", stderr: "", status: 1 } // no local trunk
        : { stdout: "", stderr: "", status: 0 },
    );
    const { publishRelease } = await import("../../src/git/gitService.js");
    publishRelease("1.3.0", false, "master", "gitflow");

    const calls = mockSpawnSync.mock.calls.map((c) => (c as [string, string[]])[1].join(" "));
    // `--track` is deliberately absent: git refuses it in a --single-branch
    // clone, which is the clone shape this whole feature exists for.
    expect(calls).toContain("checkout -b master origin/master");
    expect(calls.join("\n")).not.toContain("--track");
  });

  it("throws with descriptive error when a step fails", async () => {
    mockSpawnSync
      .mockReturnValueOnce({ stdout: "0f0dba2", stderr: "", status: 0 }) // rev-parse → trunk exists
      .mockReturnValueOnce({ stdout: "", stderr: "", status: 0 }) // checkout -b
      .mockReturnValueOnce({ stdout: "", stderr: "", status: 0 }) // checkout trunk
      .mockReturnValueOnce({ stdout: "", stderr: "CONFLICT (content)", status: 1 }); // merge fails
    const { publishRelease } = await import("../../src/git/gitService.js");
    expect(() => publishRelease("1.3.0", false, "master", "gitflow")).toThrow("CONFLICT (content)");
  });

  it("runs no mutating git command in a dry run", async () => {
    // Asserted against an explicit list rather than "spawnSync was never called":
    // the dry run legitimately probes for the local trunk, so a blanket
    // assertion would have to be loosened — and would then stop catching a new
    // mutation added later.
    const MUTATORS = ["checkout", "merge", "tag", "branch", "push", "fetch", "commit", "reset"];
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    mockSpawnSync.mockReturnValue({ stdout: "0f0dba2", stderr: "", status: 0 });
    const { publishRelease } = await import("../../src/git/gitService.js");
    publishRelease("1.3.0", true, "main", "gitflow");

    const executed = mockSpawnSync.mock.calls.map((c) => (c as [string, string[]])[1][0]);
    for (const mutator of MUTATORS) {
      expect(executed).not.toContain(mutator);
    }
    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("[dry-run] git checkout -b release/1.3.0");
    expect(output).toContain("[dry-run] git push origin develop main 1.3.0");
    writeSpy.mockRestore();
  });
});

describe("gitService.checkReleasePreconditions", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
    mockReadConfig.mockReset();
    mockReadConfig.mockReturnValue({});
    mockReadRawConfig.mockReset();
    mockReadRawConfig.mockReturnValue({});
  });
  afterEach(() => vi.resetModules());

  it("passes on develop with a clean tree", async () => {
    mockSpawnSync
      .mockReturnValueOnce({ stdout: "develop\n", stderr: "", status: 0 })
      .mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });
    const { checkReleasePreconditions } = await import("../../src/git/gitService.js");
    expect(checkReleasePreconditions("develop")).toEqual({ ok: true });
  });

  it("names the current branch when it is not develop", async () => {
    mockSpawnSync.mockReturnValueOnce({ stdout: "feature/x\n", stderr: "", status: 0 });
    const { checkReleasePreconditions } = await import("../../src/git/gitService.js");
    const result = checkReleasePreconditions("develop");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("currently on 'feature/x'");
  });

  it("refuses a dirty working tree", async () => {
    mockSpawnSync
      .mockReturnValueOnce({ stdout: "develop\n", stderr: "", status: 0 })
      .mockReturnValueOnce({ stdout: " M src/index.ts\n", stderr: "", status: 0 });
    const { checkReleasePreconditions } = await import("../../src/git/gitService.js");
    const result = checkReleasePreconditions("develop");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("uncommitted changes");
  });

  it("checks against the branch it is given, so the trunk flow can require the trunk", async () => {
    mockSpawnSync.mockReturnValueOnce({ stdout: "develop\n", stderr: "", status: 0 });
    const { checkReleasePreconditions } = await import("../../src/git/gitService.js");
    const result = checkReleasePreconditions("main");
    expect(result).toEqual({
      ok: false,
      message: "publish-release must be run from the 'main' branch (currently on 'develop').",
    });
  });

  it("reports the failure when the current branch cannot be read", async () => {
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "fatal: not a git repository", status: 128 });
    const { checkReleasePreconditions } = await import("../../src/git/gitService.js");
    const result = checkReleasePreconditions("develop");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("Failed to determine current branch");
  });
});

describe("gitService.probeRemoteBranch", () => {
  beforeEach(() => mockSpawnSync.mockReset());
  afterEach(() => vi.resetModules());

  it("asks origin with --exit-code, reading 0 as present", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "abc\trefs/heads/develop\n", stderr: "", status: 0 });
    const { probeRemoteBranch } = await import("../../src/git/gitService.js");
    expect(probeRemoteBranch("develop")).toEqual({ ok: true, exists: true });
    expect(mockSpawnSync.mock.calls[0][1]).toEqual(["ls-remote", "--exit-code", "--heads", "origin", "develop"]);
  });

  it("reads exit 2 as absent", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "", status: 2 });
    const { probeRemoteBranch } = await import("../../src/git/gitService.js");
    expect(probeRemoteBranch("develop")).toEqual({ ok: true, exists: false });
  });

  it("reports any other exit as a failure, not as absent", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "fatal: unable to access remote\n", status: 128 });
    const { probeRemoteBranch } = await import("../../src/git/gitService.js");
    expect(probeRemoteBranch("develop")).toEqual({ ok: false, message: "fatal: unable to access remote" });
  });
});

describe("gitService.resolveReleaseFlow", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
    mockReadRawConfig.mockReset();
    mockReadRawConfig.mockReturnValue({});
  });
  afterEach(() => vi.resetModules());

  it.each([["gitflow"], ["trunk"]])("uses a configured %s and probes nothing", async (flow) => {
    mockReadRawConfig.mockReturnValue({ git: { releaseFlow: flow } });
    const { resolveReleaseFlow } = await import("../../src/git/gitService.js");
    expect(resolveReleaseFlow()).toEqual({ ok: true, flow, source: "config" });
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it("refuses an invalid configured value rather than detecting", async () => {
    mockReadRawConfig.mockReturnValue({ git: { releaseFlow: "trunk-based" } });
    const { resolveReleaseFlow } = await import("../../src/git/gitService.js");
    const result = resolveReleaseFlow();
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('"trunk-based"');
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it("detects gitflow when origin has develop", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "abc\trefs/heads/develop\n", stderr: "", status: 0 });
    const { resolveReleaseFlow } = await import("../../src/git/gitService.js");
    expect(resolveReleaseFlow()).toEqual({ ok: true, flow: "gitflow", source: "develop-present" });
  });

  it("detects trunk when origin has no develop", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "", status: 2 });
    const { resolveReleaseFlow } = await import("../../src/git/gitService.js");
    expect(resolveReleaseFlow()).toEqual({ ok: true, flow: "trunk", source: "develop-absent" });
  });

  it("refuses when the probe fails, naming git's error and the setter", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "fatal: could not read from remote", status: 128 });
    const { resolveReleaseFlow } = await import("../../src/git/gitService.js");
    const result = resolveReleaseFlow();
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("fatal: could not read from remote");
    expect(result.ok === false && result.message).toContain("automata config set git-release-flow");
  });
});

describe("gitService.publishRelease — trunk flow", () => {
  beforeEach(() => mockSpawnSync.mockReset());
  afterEach(() => vi.resetModules());

  it("commits, tags and pushes atomically, in that order, and nothing else", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "", status: 0 });
    const { publishRelease } = await import("../../src/git/gitService.js");
    publishRelease("1.3.0", false, "main", "trunk");

    const calls = mockSpawnSync.mock.calls.map((c) => (c as [string, string[]])[1].join(" "));
    expect(calls).toEqual([
      "commit --allow-empty -m chore(release): 1.3.0",
      "tag 1.3.0",
      "push --atomic origin main 1.3.0",
    ]);
  });

  it("stops at the failed push and names it", async () => {
    mockSpawnSync
      .mockReturnValueOnce({ stdout: "", stderr: "", status: 0 })
      .mockReturnValueOnce({ stdout: "", stderr: "", status: 0 })
      .mockReturnValueOnce({ stdout: "", stderr: "! [rejected] main -> main (fetch first)", status: 1 });
    const { publishRelease } = await import("../../src/git/gitService.js");
    expect(() => publishRelease("1.3.0", false, "main", "trunk")).toThrow(
      "Command failed: git push --atomic origin main 1.3.0",
    );
  });

  it("runs nothing at all in a dry run and prints the three commands", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const { publishRelease } = await import("../../src/git/gitService.js");
    publishRelease("1.3.0", true, "main", "trunk");

    expect(mockSpawnSync).not.toHaveBeenCalled();
    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toBe(
      '[dry-run] git commit --allow-empty -m "chore(release): 1.3.0"\n' +
        "[dry-run] git tag 1.3.0\n" +
        "[dry-run] git push --atomic origin main 1.3.0\n",
    );
    writeSpy.mockRestore();
  });
});
