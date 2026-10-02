import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockReadConfig = vi.fn();
const mockLogin = vi.fn();
const mockAcquire = vi.fn();
const mockRelease = vi.fn();
const mockRawConfig = vi.fn();
const mockWrite = vi.fn();
const mockTarget = vi.fn();
const mockApply = vi.fn();
const mockLinks = vi.fn();

vi.mock("../../src/config/configStore.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config/configStore.js")>();
  return {
    ...actual,
    readConfig: () => mockReadConfig(),
    readRawConfig: () => mockRawConfig(),
    writeConfig: (...a: unknown[]) => mockWrite(...a),
  };
});
vi.mock("../../src/github/ghWorkService.js", () => ({
  getAuthenticatedLogin: () => mockLogin(),
  getWatchTarget: (...a: unknown[]) => mockTarget(...a),
  applyDiscovery: (...a: unknown[]) => mockApply(...a),
  getOpenPrLinkMap: () => mockLinks(),
}));
vi.mock("../../src/run/runLock.js", () => ({
  CONDUCTOR_LOCK_RELATIVE_PATH: ".automata/conductor.lock",
  acquireConductorLock: (...a: unknown[]) => mockAcquire(...a),
}));

const CONFIG = { remoteType: "gh", allowedUsers: ["alice"], agentUser: "bot" };

let stdout = "";
let stderr = "";

beforeEach(() => {
  stdout = "";
  stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((s) => ((stdout += String(s)), true));
  vi.spyOn(process.stderr, "write").mockImplementation((s) => ((stderr += String(s)), true));
  mockReadConfig.mockReturnValue(CONFIG);
  mockLogin.mockReturnValue("alice");
  mockRawConfig.mockReturnValue({ ...CONFIG, issueDiscoveryTechnique: "label", issueDiscoveryValue: "automata" });
  mockLinks.mockReturnValue({ byIssue: new Map() });
  mockAcquire.mockReturnValue({ ok: true, handle: { release: mockRelease } });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function run(): Promise<number> {
  const { runConductor } = await import("../../src/commands/conductor.js");
  return runConductor();
}

describe("conductor", () => {
  it("runs a tick as an allowed user and releases its lock", async () => {
    expect(await run()).toBe(0);
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it.each([0, -5, "30", 1.5])("exits 1 on an invalid doWork.lockStaleMinutes (%j), without taking the lock", async (bad) => {
    mockReadConfig.mockReturnValue({ ...CONFIG, doWork: { lockStaleMinutes: bad } });
    expect(await run()).toBe(1);
    expect(stderr).toMatch(/doWork\.lockStaleMinutes must be a positive integer/);
    expect(mockAcquire).not.toHaveBeenCalled();
  });

  it("exits 1 when gh is the agent, without taking the lock", async () => {
    mockLogin.mockReturnValue("bot");
    expect(await run()).toBe(1);
    expect(stderr).toMatch(/is the agent/);
    expect(mockAcquire).not.toHaveBeenCalled();
  });

  it("exits 1 when gh is not an allowed user", async () => {
    mockLogin.mockReturnValue("carol");
    expect(await run()).toBe(1);
    expect(stderr).toMatch(/not listed in allowedUsers/);
  });

  it("exits 1 when the account cannot be determined", async () => {
    mockLogin.mockReturnValue(null);
    expect(await run()).toBe(1);
  });

  it("exits 1 when allowedUsers or agentUser is missing", async () => {
    mockReadConfig.mockReturnValue({ remoteType: "gh", agentUser: "bot" });
    expect(await run()).toBe(1);
    expect(stderr).toMatch(/allowed users/);
  });

  it("exits 1 for an Azure DevOps remote", async () => {
    mockReadConfig.mockReturnValue({ ...CONFIG, remoteType: "azdo" });
    expect(await run()).toBe(1);
  });

  it("does nothing and exits 0 when another conductor holds the lock", async () => {
    mockAcquire.mockReturnValue({
      ok: false,
      suspect: false,
      heldBy: { pid: 7, host: "h", startedAt: "t", command: "conductor", token: "x" },
    });
    expect(await run()).toBe(0);
    expect(stdout).toMatch(/already running/);
  });

  it("exits 2 for a suspect lock", async () => {
    mockAcquire.mockReturnValue({
      ok: false,
      suspect: true,
      heldBy: { pid: 7, host: "h", startedAt: "t", command: "conductor", token: "x" },
    });
    expect(await run()).toBe(2);
    expect(stderr).toMatch(/conductor\.lock/);
  });
});

const issue = (n: number, state = "open") => ({ number: n, kind: "issue", state, title: `T${String(n)}` });
const pr = (n: number, state = "open") => ({ number: n, kind: "pr", state, title: `P${String(n)}` });

describe("conductor watch list", () => {
  async function call(name: "runWatchAdd" | "runWatchRemove", id: string): Promise<number> {
    const mod = await import("../../src/commands/conductor.js");
    return mod[name](id);
  }
  const written = () => mockWrite.mock.calls.at(-1)?.[0] as { conductor: { watch: number[] } };

  it("add applies the discovery label, stores the id and follows the linked PR", async () => {
    mockTarget.mockReturnValue(issue(114));
    mockLinks.mockReturnValue({ byIssue: new Map([[114, [{ number: 130 }]]]) });
    expect(await call("runWatchAdd", "114")).toBe(0);
    expect(mockApply).toHaveBeenCalledWith(issue(114), "label", "automata", "bot");
    expect(written().conductor.watch).toEqual([114, 130]);
    expect(stdout).toMatch(/linked PR #130/);
  });

  it("add keeps the existing list and writes nothing new for a known id", async () => {
    mockRawConfig.mockReturnValue({ ...CONFIG, issueDiscoveryTechnique: "label", issueDiscoveryValue: "a", conductor: { watch: [5] } });
    mockTarget.mockReturnValue(pr(5));
    expect(await call("runWatchAdd", "5")).toBe(0);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("add refuses a closed item and a bad id", async () => {
    mockTarget.mockReturnValue(issue(9, "closed"));
    expect(await call("runWatchAdd", "9")).toBe(1);
    expect(await call("runWatchAdd", "abc")).toBe(1);
    expect(mockApply).not.toHaveBeenCalled();
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("add fails when applying the discovery setting fails, storing nothing", async () => {
    mockTarget.mockReturnValue(issue(9));
    mockApply.mockImplementation(() => {
      throw new Error("title-contains cannot be applied");
    });
    expect(await call("runWatchAdd", "9")).toBe(1);
    expect(stderr).toMatch(/cannot be applied/);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("add requires a discovery technique", async () => {
    mockRawConfig.mockReturnValue(CONFIG);
    expect(await call("runWatchAdd", "9")).toBe(1);
  });

  it("remove drops the id and leaves GitHub alone", async () => {
    mockRawConfig.mockReturnValue({ ...CONFIG, conductor: { watch: [1, 2] } });
    expect(await call("runWatchRemove", "1")).toBe(0);
    expect(written().conductor.watch).toEqual([2]);
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("remove of an unknown id exits 1", async () => {
    expect(await call("runWatchRemove", "1")).toBe(1);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("list prints each item, and notes an empty list", async () => {
    const { runWatchList } = await import("../../src/commands/conductor.js");
    expect(runWatchList()).toBe(0);
    expect(stdout).toMatch(/empty/);
    mockRawConfig.mockReturnValue({ ...CONFIG, conductor: { watch: [1, 2] } });
    mockTarget.mockImplementation((n: number) => {
      if (n === 2) throw new Error("boom");
      return issue(n);
    });
    stdout = "";
    runWatchList();
    expect(stdout).toMatch(/issue #1 \(open\): T1/);
    expect(stdout).toMatch(/#2: unavailable \(boom\)/);
  });

  it("the tick drops closed items, logs each, and keeps unreadable ones", async () => {
    const watching = { ...CONFIG, conductor: { watch: [1, 2, 3, 4] } };
    mockReadConfig.mockReturnValue(watching);
    mockRawConfig.mockReturnValue(watching);
    mockTarget.mockImplementation((n: number) => {
      if (n === 1) return issue(1, "closed");
      if (n === 2) return pr(2, "closed");
      if (n === 3) throw new Error("net");
      return issue(4);
    });
    expect(await run()).toBe(0);
    expect(stdout).toMatch(/dropped issue #1/);
    expect(stdout).toMatch(/dropped PR #2/);
    expect(stderr).toMatch(/keeping it watched/);
    expect(written().conductor.watch).toEqual([3, 4]);
  });
});
