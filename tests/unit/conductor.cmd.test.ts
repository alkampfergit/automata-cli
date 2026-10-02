import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockReadConfig = vi.fn();
const mockLogin = vi.fn();
const mockAcquire = vi.fn();
const mockRelease = vi.fn();

vi.mock("../../src/config/configStore.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config/configStore.js")>();
  return { ...actual, readConfig: () => mockReadConfig() };
});
vi.mock("../../src/github/ghWorkService.js", () => ({
  getAuthenticatedLogin: () => mockLogin(),
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
