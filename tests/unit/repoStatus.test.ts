import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSpawnSync = vi.fn();

vi.mock("node:child_process", () => ({
  spawnSync: (...a: unknown[]) => mockSpawnSync(...a),
}));

const { inspectRepoStatus } = await import("../../src/git/repoStatus.js");

/**
 * Every test asserts the argv, not only the parsed result.
 *
 * The module's whole promise is "this cannot modify the checkout", and a promise
 * like that is only worth what its tests assert: a future `git checkout` added
 * here would still return the right `RepoStatus`, and only an argv assertion
 * notices it.
 */

type Result = { stdout?: string; stderr?: string; status?: number };

let responses: { match: (args: string[]) => boolean; result: Result }[] = [];
let calls: string[][] = [];

function respond(prefix: string[], result: Result): void {
  responses.push({
    match: (args) => prefix.every((part, index) => args[index] === part),
    result,
  });
}

beforeEach(() => {
  responses = [];
  calls = [];
  mockSpawnSync.mockReset();
  mockSpawnSync.mockImplementation((_cmd: string, args: string[]) => {
    calls.push(args);
    // Last registered wins, so a test can override a default set up by `clean()`.
    const hit = [...responses].reverse().find((candidate) => candidate.match(args));
    const result = hit?.result ?? { status: 1 };
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status ?? 0 };
  });
});

/** The happy path: on the base branch, clean, level with its upstream. */
function clean(): void {
  respond(["rev-parse", "--short", "HEAD"], { stdout: "abc1234\n", status: 0 });
  respond(["symbolic-ref"], { stdout: "develop\n", status: 0 });
  respond(["status", "--porcelain"], { stdout: "", status: 0 });
  respond(["rev-parse", "--verify", "--quiet", "refs/heads/develop"], {
    stdout: "abc\n",
    status: 0,
  });
  respond(["fetch"], { status: 0 });
  respond(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "develop@{u}"], {
    stdout: "origin/develop\n",
    status: 0,
  });
  respond(["rev-list"], { stdout: "0\t0\n", status: 0 });
}

const MUTATING = [
  "checkout",
  "commit",
  "add",
  "push",
  "pull",
  "reset",
  "merge",
  "rebase",
  "branch",
  "stash",
  "clean",
  "switch",
  "restore",
  "cherry-pick",
  "am",
  "apply",
  "tag",
];

function assertNoMutation(): void {
  for (const args of calls) {
    expect(MUTATING).not.toContain(args[0]);
    // The one write that is allowed writes a remote-tracking ref and nothing else.
    if (args[0] === "fetch")
      expect(args).toEqual(["fetch", "origin", expect.stringContaining("refs/remotes/origin/")]);
  }
}

describe("inspectRepoStatus", () => {
  it("reports a clean checkout level with its upstream", () => {
    clean();
    const status = inspectRepoStatus({ baseBranch: "develop", fetch: true });

    expect(status).toMatchObject({
      branch: "develop",
      head: "abc1234",
      dirtyPaths: [],
      baseBranch: "develop",
      baseLocal: true,
      upstream: "origin/develop",
      ahead: 0,
      behind: 0,
      refreshed: true,
      fetchError: null,
      error: null,
    });
    assertNoMutation();
  });

  it("issues only read-only commands, plus the one permitted fetch", () => {
    clean();
    inspectRepoStatus({ baseBranch: "develop", fetch: true });

    expect(calls).toContainEqual([
      "fetch",
      "origin",
      "+refs/heads/develop:refs/remotes/origin/develop",
    ]);
    assertNoMutation();
  });

  it("makes no network call and reports the figures as unrefreshed when fetch is off", () => {
    clean();
    const status = inspectRepoStatus({ baseBranch: "develop", fetch: false });

    expect(calls.some((args) => args[0] === "fetch")).toBe(false);
    expect(status.refreshed).toBe(false);
    expect(status.fetchError).toBeNull();
    // The ahead/behind figures still come back — from the last successful fetch.
    expect(status.ahead).toBe(0);
    assertNoMutation();
  });

  it("reports a failed fetch without throwing, and still reads divergence", () => {
    clean();
    respond(["fetch"], { status: 128, stderr: "fatal: unable to access 'https://…'\n" });
    const status = inspectRepoStatus({ baseBranch: "develop", fetch: true });

    expect(status.refreshed).toBe(false);
    expect(status.fetchError).toBe("fatal: unable to access 'https://…'");
    expect(status.ahead).toBe(0);
  });

  it("lists uncommitted changes and excludes automata's own lock file", () => {
    clean();
    respond(["status", "--porcelain"], {
      stdout: " M src/index.ts\n?? notes.txt\n?? .automata/automata.lock\n",
      status: 0,
    });
    const status = inspectRepoStatus({ baseBranch: "develop", fetch: true });

    expect(status.dirtyPaths).toEqual([" M src/index.ts", "?? notes.txt"]);
  });

  it("reports a detached HEAD as a null branch", () => {
    clean();
    respond(["symbolic-ref"], { status: 1 });
    const status = inspectRepoStatus({ baseBranch: "develop", fetch: true });

    expect(status.branch).toBeNull();
    expect(status.head).toBe("abc1234");
  });

  it("orders ahead and behind the way `--left-right` prints them", () => {
    clean();
    // upstream...branch, so the left count is *behind* and the right is *ahead*.
    respond(["rev-list"], { stdout: "5\t2\n", status: 0 });
    const status = inspectRepoStatus({ baseBranch: "develop", fetch: true });

    expect(status.behind).toBe(5);
    expect(status.ahead).toBe(2);
  });

  it("reports a base branch that is absent locally", () => {
    clean();
    respond(["rev-parse", "--verify", "--quiet", "refs/heads/develop"], { status: 1 });
    respond(["rev-parse", "--verify", "--quiet", "refs/remotes/origin/develop"], { status: 1 });
    const status = inspectRepoStatus({ baseBranch: "develop", fetch: true });

    expect(status.baseLocal).toBe(false);
    expect(status.upstream).toBeNull();
    expect(status.ahead).toBeNull();
    expect(status.behind).toBeNull();
  });

  it("falls back to origin/<base> when the local branch has no configured upstream", () => {
    clean();
    respond(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "develop@{u}"], { status: 128 });
    respond(["rev-parse", "--verify", "--quiet", "refs/remotes/origin/develop"], {
      stdout: "def\n",
      status: 0,
    });
    const status = inspectRepoStatus({ baseBranch: "develop", fetch: true });

    expect(status.upstream).toBe("origin/develop");
  });

  it("reports no upstream when neither the configured one nor origin/<base> exists", () => {
    clean();
    respond(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "develop@{u}"], { status: 128 });
    respond(["rev-parse", "--verify", "--quiet", "refs/remotes/origin/develop"], { status: 1 });
    const status = inspectRepoStatus({ baseBranch: "develop", fetch: true });

    expect(status.upstream).toBeNull();
    expect(status.ahead).toBeNull();
  });

  it("reports a directory that is not a git repository rather than throwing", () => {
    respond(["rev-parse", "--short", "HEAD"], {
      status: 128,
      stderr: "fatal: not a git repository\n",
    });
    respond(["rev-parse", "--is-inside-work-tree"], { status: 128 });
    const status = inspectRepoStatus({ baseBranch: "develop", fetch: true });

    expect(status.error).toBe("fatal: not a git repository");
    expect(status.branch).toBeNull();
    // It stopped there: no point interrogating a directory that is not a repository.
    expect(calls.some((args) => args[0] === "status")).toBe(false);
  });

  it("returns nulls rather than NaN when rev-list prints something unexpected", () => {
    clean();
    respond(["rev-list"], { stdout: "weird\n", status: 0 });
    const status = inspectRepoStatus({ baseBranch: "develop", fetch: true });

    expect(status.ahead).toBeNull();
    expect(status.behind).toBeNull();
  });
});
