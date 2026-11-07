import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const git = vi.hoisted(() => ({
  fetchPruneOrigin: vi.fn(),
  listRemoteBranches: vi.fn(),
  listLocalBranches: vi.fn(),
  getCurrentBranch: vi.fn(),
  resolveTrunkBranch: vi.fn(),
  countUnpushedCommits: vi.fn(),
  forceDeleteLocalBranch: vi.fn(),
  deleteRemoteBranch: vi.fn(),
}));
const gh = vi.hoisted(() => ({ listSameRepoPullRequests: vi.fn() }));
const config = vi.hoisted(() => ({ readRawConfig: vi.fn() }));

vi.mock("../../src/git/gitService.js", () => git);
vi.mock("../../src/github/ghWorkService.js", () => gh);
vi.mock("../../src/config/configStore.js", () => config);

import { runCleanBranches } from "../../src/commands/cleanBranches.js";

let out = "";
let err = "";
const ok = { ok: true, stderr: "" };

beforeEach(() => {
  out = "";
  err = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    err += String(chunk);
    return true;
  });
  Object.values(git).forEach((fn) => fn.mockReset());
  gh.listSameRepoPullRequests.mockReset();
  config.readRawConfig.mockReturnValue({});
  git.fetchPruneOrigin.mockReturnValue(ok);
  git.listRemoteBranches.mockReturnValue(["develop", "feature/done", "feature/open", "feature/never"]);
  git.listLocalBranches.mockReturnValue(["develop", "feature/current", "feature/stale"]);
  git.getCurrentBranch.mockReturnValue("feature/current");
  git.resolveTrunkBranch.mockReturnValue({ ok: true, branch: "develop", source: "probe" });
  git.countUnpushedCommits.mockReturnValue(0);
  git.forceDeleteLocalBranch.mockReturnValue(ok);
  git.deleteRemoteBranch.mockReturnValue(ok);
  gh.listSameRepoPullRequests.mockImplementation((b: string) => {
    if (b === "feature/done") return [{ number: 7, state: "MERGED" }];
    if (b === "feature/open") return [{ number: 8, state: "OPEN" }];
    return [];
  });
  Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runCleanBranches", () => {
  it("deletes the stale local branch and the finished remote branch with --yes", async () => {
    expect(await runCleanBranches({ yes: true })).toBe(0);
    expect(git.fetchPruneOrigin).toHaveBeenCalled();
    expect(git.forceDeleteLocalBranch.mock.calls).toEqual([["feature/stale"]]);
    expect(git.deleteRemoteBranch.mock.calls).toEqual([["feature/done"]]);
    expect(out).toContain("keep");
    expect(out).toContain("no pull request");
  });

  it("changes nothing in a dry run", async () => {
    expect(await runCleanBranches({ dryRun: true })).toBe(0);
    expect(git.forceDeleteLocalBranch).not.toHaveBeenCalled();
    expect(git.deleteRemoteBranch).not.toHaveBeenCalled();
    expect(out).toContain("would delete");
  });

  it("runs only the local phase with --local-only and never asks gh", async () => {
    await runCleanBranches({ yes: true, localOnly: true });
    expect(git.forceDeleteLocalBranch).toHaveBeenCalledOnce();
    expect(git.deleteRemoteBranch).not.toHaveBeenCalled();
    expect(gh.listSameRepoPullRequests).not.toHaveBeenCalled();
  });

  it("runs only the remote phase with --remote-only", async () => {
    await runCleanBranches({ yes: true, remoteOnly: true });
    expect(git.forceDeleteLocalBranch).not.toHaveBeenCalled();
    expect(git.deleteRemoteBranch).toHaveBeenCalledOnce();
  });

  it("refuses both phase flags together", async () => {
    expect(await runCleanBranches({ localOnly: true, remoteOnly: true })).toBe(1);
    expect(err).toContain("cannot be used together");
    expect(git.fetchPruneOrigin).not.toHaveBeenCalled();
  });

  it("deletes nothing without --yes when there is no terminal", async () => {
    expect(await runCleanBranches({})).toBe(1);
    expect(err).toContain("Confirmation needs a terminal");
    expect(git.forceDeleteLocalBranch).not.toHaveBeenCalled();
  });

  it("deletes nothing when origin cannot be listed", async () => {
    git.listRemoteBranches.mockReturnValue(null);
    expect(await runCleanBranches({ yes: true })).toBe(1);
    expect(git.forceDeleteLocalBranch).not.toHaveBeenCalled();
  });

  it("stops when the fetch fails", async () => {
    git.fetchPruneOrigin.mockReturnValue({ ok: false, stderr: "offline" });
    expect(await runCleanBranches({ yes: true })).toBe(1);
    expect(err).toContain("offline");
  });

  it("exits 1 after a failed deletion and still tries the others", async () => {
    git.forceDeleteLocalBranch.mockReturnValue({ ok: false, stderr: "worktree" });
    expect(await runCleanBranches({ yes: true })).toBe(1);
    expect(git.deleteRemoteBranch).toHaveBeenCalledOnce();
    expect(err).toContain("Failed to delete local branch feature/stale: worktree");
  });

  it("keeps a branch and exits 1 when the pull request lookup fails", async () => {
    gh.listSameRepoPullRequests.mockImplementation(() => {
      throw new Error("gh not authenticated");
    });
    expect(await runCleanBranches({ yes: true })).toBe(1);
    expect(git.deleteRemoteBranch).not.toHaveBeenCalled();
    expect(out).toContain("pull request lookup failed");
  });

  it("rejects the remote phase for Azure DevOps but allows --local-only", async () => {
    config.readRawConfig.mockReturnValue({ remoteType: "azdo" });
    expect(await runCleanBranches({ yes: true })).toBe(1);
    expect(err).toContain("not supported for Azure DevOps");
    expect(await runCleanBranches({ yes: true, localOnly: true })).toBe(0);
  });

  it("reports nothing to delete", async () => {
    git.listLocalBranches.mockReturnValue(["develop"]);
    gh.listSameRepoPullRequests.mockReturnValue([]);
    expect(await runCleanBranches({ yes: true })).toBe(0);
    expect(out).toContain("Nothing to delete.");
  });
});
