import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockReadConfig = vi.fn();
const mockLogin = vi.fn();
const mockAcquire = vi.fn();
const mockRelease = vi.fn();
const mockInspect = vi.fn();
const mockInspectRun = vi.fn();
const mockRawConfig = vi.fn();
let watchState: number[] = [];
const mockWriteWatch = vi.fn((list: number[]) => {
  watchState = list;
});
let storyState: number[] = [];
const mockStorySource = vi.fn();
const mockCloseIssue = vi.fn();
const mockCommentOnIssue = vi.fn();
const mockTarget = vi.fn();
const mockApply = vi.fn();
const mockAddLabel = vi.fn();
const mockPostMarker = vi.fn();
const mockLinks = vi.fn();
const mockIssueSurface = vi.fn();
const mockPrSurface = vi.fn();
const mockChecks = vi.fn();
const mockRunClaude = vi.fn();
const mockRunCodex = vi.fn();

vi.mock("../../src/config/configStore.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config/configStore.js")>();
  return {
    ...actual,
    readConfig: () => mockReadConfig(),
    readRawConfig: () => mockRawConfig(),
  };
});
vi.mock("../../src/conductor/watchStore.js", () => ({
  readWatch: () => watchState,
  writeWatch: (list: number[]) => mockWriteWatch(list),
  readStories: () => storyState,
  writeStories: (list: number[]) => {
    storyState = list;
  },
}));
vi.mock("../../src/github/ghWorkService.js", () => ({
  getAuthenticatedLogin: () => mockLogin(),
  getWatchTarget: (...a: unknown[]) => mockTarget(...a),
  getStorySource: (...a: unknown[]) => mockStorySource(...a),
  closeIssue: (...a: unknown[]) => mockCloseIssue(...a),
  commentOnIssue: (...a: unknown[]) => mockCommentOnIssue(...a),
  applyDiscovery: (...a: unknown[]) => mockApply(...a),
  addLabel: (...a: unknown[]) => mockAddLabel(...a),
  postMarker: (...a: unknown[]) => mockPostMarker(...a),
  getOpenPrLinkMap: () => mockLinks(),
  getIssueSurface: (...a: unknown[]) => mockIssueSurface(...a),
  getPrSurface: (...a: unknown[]) => mockPrSurface(...a),
  getPrChecks: (...a: unknown[]) => mockChecks(...a),
  getRepoSlug: () => ({ owner: "acme", repo: "widget" }),
}));
vi.mock("../../src/claude/claudeService.js", () => ({
  runClaude: (...a: unknown[]) => mockRunClaude(...a),
}));
vi.mock("../../src/codex/codexService.js", () => ({
  runCodex: (...a: unknown[]) => mockRunCodex(...a),
}));
vi.mock("../../src/run/runLock.js", () => ({
  CONDUCTOR_LOCK_RELATIVE_PATH: ".automata/conductor.lock",
  acquireConductorLock: (...a: unknown[]) => mockAcquire(...a),
  inspectConductorLock: (...a: unknown[]) => mockInspect(...a),
  inspectRunLock: (...a: unknown[]) => mockInspectRun(...a),
}));

function text(author: string, createdAt: string, body: string) {
  return { kind: "issue-comment", author, body, createdAt };
}
function issueSurface(n: number, messages: unknown[]) {
  return { issue: { number: n, title: `T${String(n)}`, body: "", url: `https://gh/issues/${String(n)}` }, state: "OPEN", assignees: [], labels: [], messages };
}

const CONFIG = { remoteType: "gh", allowedUsers: ["alice"], agentUser: "bot" };

let stdout = "";
let stderr = "";

beforeEach(() => {
  stdout = "";
  stderr = "";
  watchState = [];
  storyState = [];
  mockStorySource.mockReturnValue({ via: "none", state: "open", title: "", children: [] });
  vi.spyOn(process.stdout, "write").mockImplementation((s) => ((stdout += String(s)), true));
  vi.spyOn(process.stderr, "write").mockImplementation((s) => ((stderr += String(s)), true));
  mockReadConfig.mockReturnValue(CONFIG);
  mockLogin.mockReturnValue("alice");
  mockRawConfig.mockReturnValue({ ...CONFIG, issueDiscoveryTechnique: "label", issueDiscoveryValue: "automata" });
  mockLinks.mockReturnValue({ byIssue: new Map() });
  mockAcquire.mockReturnValue({ ok: true, handle: { release: mockRelease } });
  mockInspect.mockReturnValue({ kind: "free" });
  mockInspectRun.mockReturnValue({ kind: "free" });
  mockIssueSurface.mockImplementation((n: number) => issueSurface(n, [text("alice", "t1", "hi")]));
  mockChecks.mockReturnValue([]);
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

const issue = (n: number, state = "open") => ({ number: n, kind: "issue", state, title: `T${String(n)}`, labels: [] as string[] });
const pr = (n: number, state = "open") => ({ number: n, kind: "pr", state, title: `P${String(n)}`, labels: [] as string[] });

describe("conductor watch list", () => {
  async function call(name: "runWatchAdd" | "runWatchRemove", id: string): Promise<number> {
    const mod = await import("../../src/commands/conductor.js");
    return mod[name](id);
  }
  const written = () => ({ conductor: { watch: mockWriteWatch.mock.calls.at(-1)?.[0] as number[] } });

  it("add applies the discovery label, stores the id and follows the linked PR", async () => {
    mockTarget.mockReturnValue(issue(114));
    mockLinks.mockReturnValue({ byIssue: new Map([[114, [{ number: 130 }]]]) });
    expect(await call("runWatchAdd", "114")).toBe(0);
    expect(mockApply).toHaveBeenCalledWith(issue(114), "label", "automata");
    expect(written().conductor.watch).toEqual([114, 130]);
    expect(stdout).toMatch(/linked PR #130/);
  });

  it("add keeps the existing list and writes nothing new for a known id", async () => {
    watchState = [5];
    mockRawConfig.mockReturnValue({ ...CONFIG, issueDiscoveryTechnique: "label", issueDiscoveryValue: "a" });
    mockTarget.mockReturnValue(pr(5));
    expect(await call("runWatchAdd", "5")).toBe(0);
    expect(mockWriteWatch).not.toHaveBeenCalled();
  });

  it("add refuses a closed item and a bad id", async () => {
    mockTarget.mockReturnValue(issue(9, "closed"));
    expect(await call("runWatchAdd", "9")).toBe(1);
    expect(await call("runWatchAdd", "abc")).toBe(1);
    expect(mockApply).not.toHaveBeenCalled();
    expect(mockWriteWatch).not.toHaveBeenCalled();
  });

  it("add fails when applying the discovery setting fails, storing nothing", async () => {
    mockTarget.mockReturnValue(issue(9));
    mockApply.mockImplementation(() => {
      throw new Error("title-contains cannot be applied");
    });
    expect(await call("runWatchAdd", "9")).toBe(1);
    expect(stderr).toMatch(/cannot be applied/);
    expect(mockWriteWatch).not.toHaveBeenCalled();
  });

  it("add resolves linked PRs before applying discovery, so a lookup failure changes nothing", async () => {
    mockTarget.mockReturnValue(issue(9));
    mockLinks.mockImplementation(() => {
      throw new Error("graphql down");
    });
    expect(await call("runWatchAdd", "9")).toBe(1);
    expect(stderr).toMatch(/graphql down/);
    expect(mockApply).not.toHaveBeenCalled();
    expect(mockWriteWatch).not.toHaveBeenCalled();
  });

  it("add requires a discovery technique", async () => {
    mockRawConfig.mockReturnValue(CONFIG);
    expect(await call("runWatchAdd", "9")).toBe(1);
  });

  it("add rejects a missing discovery value before touching GitHub", async () => {
    for (const technique of ["label", "assignee"]) {
      mockRawConfig.mockReturnValue({ ...CONFIG, issueDiscoveryTechnique: technique, issueDiscoveryValue: "  " });
      expect(await call("runWatchAdd", "9")).toBe(1);
    }
    expect(mockApply).not.toHaveBeenCalled();
    expect(mockWriteWatch).not.toHaveBeenCalled();
  });

  it("remove drops the id and leaves GitHub alone", async () => {
    watchState = [1, 2];
    expect(await call("runWatchRemove", "1")).toBe(0);
    expect(written().conductor.watch).toEqual([2]);
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("remove of an unknown id exits 1", async () => {
    expect(await call("runWatchRemove", "1")).toBe(1);
    expect(mockWriteWatch).not.toHaveBeenCalled();
  });

  it("list prints each item, and notes an empty list", async () => {
    const { runWatchList } = await import("../../src/commands/conductor.js");
    expect(runWatchList()).toBe(0);
    expect(stdout).toMatch(/empty/);
    watchState = [1, 2];
    mockTarget.mockImplementation((n: number) => {
      if (n === 2) throw new Error("boom");
      return issue(n);
    });
    stdout = "";
    runWatchList();
    expect(stdout).toMatch(/issue #1 \(open\): T1/);
    expect(stdout).toMatch(/#2: unavailable \(boom\)/);
  });

  it("list exits 1 for an Azure DevOps remote without querying GitHub", async () => {
    watchState = [1];
    mockRawConfig.mockReturnValue({ ...CONFIG, remoteType: "azdo" });
    const { runWatchList } = await import("../../src/commands/conductor.js");
    expect(runWatchList()).toBe(1);
    expect(mockTarget).not.toHaveBeenCalled();
  });

  it("the tick drops closed items, logs each, and keeps unreadable ones", async () => {
    watchState = [1, 2, 3, 4];
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

describe("conductor tick replies", () => {
  const watching = (extra: object = {}) => {
    watchState = [7];
    const config = { ...CONFIG, conductor: { ...extra } };
    mockReadConfig.mockReturnValue(config);
    mockRawConfig.mockReturnValue(config);
    mockTarget.mockReturnValue(issue(7));
  };
  /** The agent spoke last; after the run the conductor's account has commented. */
  function agentSpokeLast(postsReply: boolean) {
    let reads = 0;
    mockIssueSurface.mockImplementation(() => {
      const base = [text("alice", "2026-10-01T09:00:00Z", "go"), text("bot", "2026-10-01T10:00:00Z", "question?")];
      // reads 1 (decision) and 2 (before) see no reply; the third (after) may.
      const reply = postsReply && reads >= 2 ? [text("alice", "2026-10-01T11:00:00Z", "answer")] : [];
      reads++;
      return issueSurface(7, [...base, ...reply]);
    });
  }

  it("runs claude read-only on a watched issue the agent spoke last on, and reports the post", async () => {
    watching({ models: { claude: "opus" }, effort: { claude: "high" } });
    agentSpokeLast(true);
    mockRunClaude.mockResolvedValue(undefined);
    expect(await run()).toBe(0);
    const [prompt, options] = mockRunClaude.mock.calls[0] as [string, Record<string, unknown>];
    expect(options).toMatchObject({ readOnly: true, model: "opus", effort: "high", ghRepo: "acme/widget" });
    expect(prompt).toContain("gh issue comment 7 --body-file -");
    expect(stdout).toMatch(/posted a reply on issue #7/);
    expect(mockRunCodex).not.toHaveBeenCalled();
  });

  it("refuses codex: it cannot be limited to comments on the reply target", async () => {
    watching({ executor: "codex", models: { codex: "gpt-x" } });
    agentSpokeLast(true);
    expect(await run()).toBe(1);
    expect(stderr).toMatch(/codex is not supported/);
    expect(mockRunCodex).not.toHaveBeenCalled();
    expect(mockRunClaude).not.toHaveBeenCalled();
  });

  it("exits 1 and says so when the run posted nothing", async () => {
    watching();
    agentSpokeLast(false);
    mockRunClaude.mockResolvedValue(undefined);
    expect(await run()).toBe(1);
    expect(stderr).toMatch(/posted no comment on issue #7/);
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("exits 1 when the run fails without posting", async () => {
    watching();
    agentSpokeLast(false);
    mockRunClaude.mockRejectedValue(new Error("exit 2"));
    expect(await run()).toBe(1);
    expect(stderr).toMatch(/failed and posted no comment.*exit 2/);
  });

  it("does not run the model when an allowed user answered last", async () => {
    watching();
    expect(await run()).toBe(0);
    expect(stdout).toMatch(/#7 needs no reply/);
    expect(mockRunClaude).not.toHaveBeenCalled();
  });

  it("exits 1 before taking the lock when the executor setting is unusable", async () => {
    watching({ executor: "gpt" });
    expect(await run()).toBe(1);
    expect(stderr).toMatch(/conductor\.executor/);
    expect(mockAcquire).not.toHaveBeenCalled();
  });
});

describe("conductor --check and --dry-run", () => {
  const watching = (...ids: number[]) => {
    watchState = ids;
  };
  // The agent wrote last on #5, so a reply is owed; #6 is answered.
  const owed = [text("bot", "2026-10-01T00:00:00Z", "question?")];
  const answered = [text("bot", "2026-10-01T00:00:00Z", "q"), text("alice", "2026-10-02T00:00:00Z", "a")];

  async function runWith(options: { check?: boolean; dryRun?: boolean; verbose?: boolean }): Promise<number> {
    const { runConductor } = await import("../../src/commands/conductor.js");
    return runConductor(options);
  }

  it("refuses both flags together, before reading anything", async () => {
    expect(await runWith({ check: true, dryRun: true })).toBe(1);
    expect(stderr).toMatch(/cannot be used together/);
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it("--check reports pending prunes and reply decisions, and writes nothing", async () => {
    watching(5, 6, 7);
    mockTarget.mockImplementation((n: number) => (n === 7 ? issue(7, "closed") : issue(n)));
    mockIssueSurface.mockImplementation((n: number) => issueSurface(n, n === 5 ? owed : answered));
    expect(await runWith({ check: true })).toBe(0);
    expect(stdout).toMatch(/issue #7: closed, a tick would drop it/);
    expect(stdout).toMatch(/reply on issue #5/);
    expect(stdout).toMatch(/skip issue #6 \(answered\)/);
    expect(stdout).toMatch(/RESULT: healthy/);
    expect(mockAcquire).not.toHaveBeenCalled();
    expect(mockWriteWatch).not.toHaveBeenCalled();
    expect(mockRunClaude).not.toHaveBeenCalled();
  });

  it("--check exits 1 for an unreadable watched item and for a bad identity", async () => {
    watching(5);
    mockTarget.mockImplementation(() => {
      throw new Error("gh down");
    });
    expect(await runWith({ check: true })).toBe(1);
    expect(stdout).toMatch(/#5 could not be read: gh down/);
    mockLogin.mockReturnValue("carol");
    stdout = "";
    expect(await runWith({ check: true })).toBe(1);
    expect(stdout).toMatch(/not listed in allowedUsers/);
  });

  it("--check exits 1 for a lock that outlived its window, and not for a live one", async () => {
    watching();
    const owner = { pid: 7, host: "h", startedAt: "t", command: "conductor", token: "x" };
    mockInspect.mockReturnValue({ kind: "held", owner, heldForMs: 1000 });
    expect(await runWith({ check: true })).toBe(0);
    mockInspect.mockReturnValue({ kind: "suspect", owner, heldForMs: 1000 });
    expect(await runWith({ check: true })).toBe(1);
  });

  it("--dry-run prints the captured reply, posts nothing, takes no lock and prunes nothing", async () => {
    watching(5, 7);
    mockTarget.mockImplementation((n: number) => (n === 7 ? issue(7, "closed") : issue(n)));
    mockIssueSurface.mockImplementation((n: number) => issueSurface(n, owed));
    mockRunClaude.mockImplementation(async (prompt: string, options: { sink: { output(s: string, t: string): void }; replyTo?: unknown }) => {
      expect(options.replyTo).toBeUndefined();
      expect(prompt).toMatch(/This is a dry run/);
      options.sink.output("stdout", JSON.stringify({ type: "result", result: "Here is my answer." }) + "\n");
    });
    expect(await runWith({ dryRun: true })).toBe(0);
    expect(stdout).toMatch(/Dry run: reply for issue #5 \(not posted\) ---\nHere is my answer\./);
    expect(stdout).toMatch(/#7 is closed; a tick would drop it/);
    expect(mockRunClaude).toHaveBeenCalledOnce();
    expect(mockAcquire).not.toHaveBeenCalled();
    expect(mockWriteWatch).not.toHaveBeenCalled();
  });

  it("--verbose lists the denied tool calls and the commands traced, on stderr, and does not change stdout", async () => {
    watching(5);
    mockTarget.mockImplementation((n: number) => issue(n));
    mockIssueSurface.mockImplementation((n: number) => issueSurface(n, owed));
    mockRunClaude.mockImplementation(async (_p: string, options: { printSteps?: boolean; echoResult?: boolean; sink: { output(s: string, t: string): void } }) => {
      expect(options.printSteps).toBe(true);
      expect(options.echoResult).toBe(false);
      const denied = [
        { tool_name: "Bash", tool_use_id: "toolu_01", tool_input: { command: "gh issue comment 5 --body x", description: "Post" } },
      ];
      options.sink.output("stdout", JSON.stringify({ type: "result", result: "NEEDS-HUMAN: denied", permission_denials: denied }) + "\n");
    });
    expect(await runWith({ verbose: true })).toBe(0);
    expect(stderr).toMatch(/denied 1 tool call\(s\):\n  - Bash gh issue comment 5 --body x/);
    expect(stderr).toMatch(/Commands \(\d+\)/);
    expect(stdout).not.toMatch(/Commands/);
  });

  it("--verbose still prints the command trace when the tick throws", async () => {
    watching(5);
    mockLinks.mockImplementation(() => {
      throw new Error("boom");
    });
    await expect(runWith({ verbose: true })).rejects.toThrow("boom");
    expect(stderr).toMatch(/Commands \(\d+\)/);
  });

  it("without --verbose the run prints no steps, no denials and no trace", async () => {
    watching(5);
    mockTarget.mockImplementation((n: number) => issue(n));
    mockIssueSurface.mockImplementation((n: number) => issueSurface(n, owed));
    mockRunClaude.mockImplementation(async (_p: string, options: { printSteps?: boolean }) => {
      expect(options.printSteps).toBe(false);
    });
    await runWith({});
    expect(stderr).not.toMatch(/denied|Commands \(/);
  });

  it("--check reads the open pull request link map once for the whole report", async () => {
    watching(5, 6);
    mockIssueSurface.mockImplementation((n: number) => issueSurface(n, answered));
    expect(await runWith({ check: true })).toBe(0);
    expect(mockLinks).toHaveBeenCalledOnce();
  });

  it("a watched pull request is decided on its own when its watched issue is blocked", async () => {
    watching(5, 50);
    mockTarget.mockImplementation((n: number) => (n === 50 ? pr(50) : { ...issue(n), labels: ["conductor-blocked"] }));
    mockLinks.mockReturnValue({ byIssue: new Map([[5, [{ number: 50 }]]]) });
    mockIssueSurface.mockImplementation((n: number) => issueSurface(n, answered));
    mockPrSurface.mockImplementation((n: number) => ({
      pr: { number: n, title: "P", body: "", url: "u", state: "OPEN", headRefName: "b", baseRefName: "develop" },
      messages: owed,
      threads: [],
    }));
    mockRunClaude.mockImplementation(async (_prompt: string, options: { sink: { output(s: string, t: string): void } }) => {
      options.sink.output("stdout", JSON.stringify({ type: "result", result: "Answer." }) + "\n");
    });
    expect(await runWith({ dryRun: true })).toBe(0);
    expect(stdout).not.toMatch(/#50 is covered by watched issue #5/);
    expect(stdout).toMatch(/#50 needs/);
  });

  it("--dry-run answers a conversation once when an issue and its linked PR are both watched", async () => {
    watching(5, 50);
    mockTarget.mockImplementation((n: number) => (n === 50 ? pr(50) : issue(n)));
    mockLinks.mockReturnValue({ byIssue: new Map([[5, [{ number: 50 }]]]) });
    mockIssueSurface.mockImplementation((n: number) => issueSurface(n, answered));
    mockPrSurface.mockImplementation((n: number) => ({
      pr: { number: n, title: "P", body: "", url: "u", state: "OPEN", headRefName: "b", baseRefName: "develop" },
      messages: owed,
      threads: [],
    }));
    mockRunClaude.mockImplementation(async (_prompt: string, options: { sink: { output(s: string, t: string): void } }) => {
      options.sink.output("stdout", JSON.stringify({ type: "result", result: "Answer." }) + "\n");
    });
    expect(await runWith({ dryRun: true })).toBe(0);
    expect(mockRunClaude).toHaveBeenCalledOnce();
    expect(stdout.match(/Dry run: reply for/g)).toHaveLength(1);
    expect(stdout).toMatch(/#50 is covered by watched issue #5/);
    expect(mockLinks).toHaveBeenCalledOnce();
  });

  it("--dry-run refuses the codex executor, as a tick does, and runs no model", async () => {
    watchState = [5];
    mockReadConfig.mockReturnValue({ ...CONFIG, conductor: { executor: "codex" } });
    expect(await runWith({ dryRun: true })).toBe(1);
    expect(stderr).toMatch(/codex is not supported/);
    expect(mockRunCodex).not.toHaveBeenCalled();
  });

  it("--dry-run exits 1 when the model prints no reply, and warns about a live lock", async () => {
    watching(5);
    mockIssueSurface.mockImplementation((n: number) => issueSurface(n, owed));
    mockInspect.mockReturnValue({ kind: "held", owner: { pid: 7, host: "h", startedAt: "t", command: "conductor", token: "x" }, heldForMs: 1 });
    mockRunClaude.mockResolvedValue(undefined);
    expect(await runWith({ dryRun: true })).toBe(1);
    expect(stderr).toMatch(/does not take the lock/);
    expect(stderr).toMatch(/produced no reply text/);
  });
});

describe("conductor loop safety", () => {
  const watching = (extra: object = {}, labels: string[] = []) => {
    watchState = [7];
    const config = { ...CONFIG, conductor: { ...extra } };
    mockReadConfig.mockReturnValue(config);
    mockRawConfig.mockReturnValue(config);
    mockTarget.mockReturnValue({ ...issue(7), labels });
  };
  const MARK = "<!-- automata:conductor -->";
  function conversation(replies: number) {
    const base = [text("alice", "2026-10-01T09:00:00Z", "go")];
    for (let i = 0; i < replies; i++) base.push(text("alice", `2026-10-02T0${String(i)}:00:00Z`, `r${String(i)}\n${MARK}`));
    base.push(text("bot", "2026-10-03T10:00:00Z", "question?"));
    mockIssueSurface.mockImplementation(() => issueSurface(7, base));
  }
  function printed(output: string) {
    return (_prompt: string, options: { sink?: { output: (s: "stdout", t: string) => void } }) => {
      options.sink?.output("stdout", JSON.stringify({ type: "result", result: output }) + "\n");
      return Promise.resolve();
    };
  }

  it("does not run the model once the item has reached maxRepliesPerItem", async () => {
    watching({ maxRepliesPerItem: 2 });
    conversation(2);
    expect(await run()).toBe(0);
    expect(mockRunClaude).not.toHaveBeenCalled();
    expect(stdout).toMatch(/#7 gets no reply: .*maxRepliesPerItem \(2\)/);
  });

  it("defaults the limit to 5", async () => {
    watching();
    conversation(4);
    mockRunClaude.mockResolvedValue(undefined);
    await run();
    expect(mockRunClaude).toHaveBeenCalledOnce();
    mockRunClaude.mockClear();
    conversation(5);
    expect(await run()).toBe(0);
    expect(mockRunClaude).not.toHaveBeenCalled();
  });

  it("rejects an unusable maxRepliesPerItem before the lock", async () => {
    watching({ maxRepliesPerItem: 0 });
    expect(await run()).toBe(1);
    expect(stderr).toMatch(/maxRepliesPerItem must be a positive integer/);
    expect(mockAcquire).not.toHaveBeenCalled();
  });

  it("does not run the model on an item with the conductor-blocked label", async () => {
    watching({}, ["conductor-blocked"]);
    conversation(0);
    expect(await run()).toBe(0);
    expect(mockRunClaude).not.toHaveBeenCalled();
    expect(stdout).toMatch(/conductor-blocked label/);
  });

  it("labels the item and stays silent when the model says it needs a human", async () => {
    watching();
    conversation(0);
    mockRunClaude.mockImplementation(printed("I cannot decide this.\nNEEDS-HUMAN: the choice is a policy call"));
    expect(await run()).toBe(0);
    expect(mockAddLabel).toHaveBeenCalledWith(expect.objectContaining({ number: 7, kind: "issue" }), "conductor-blocked", expect.any(String));
    expect(stdout).toMatch(/needs a human \(the choice is a policy call\)/);
    expect(stderr).not.toMatch(/posted no comment/);
  });

  it("exits 1 when the label cannot be applied", async () => {
    watching();
    conversation(0);
    mockRunClaude.mockImplementation(printed("NEEDS-HUMAN: stuck"));
    mockAddLabel.mockImplementation(() => {
      throw new Error("403");
    });
    expect(await run()).toBe(1);
    expect(stderr).toMatch(/label was not applied: 403/);
  });

  it("leaves a closed item alone even when the agent spoke last", async () => {
    watching();
    mockTarget.mockReturnValue({ ...issue(7, "closed"), labels: [] });
    conversation(0);
    expect(await run()).toBe(0);
    expect(mockRunClaude).not.toHaveBeenCalled();
  });

  it("a dry run obeys the limit and labels nothing for a needs-a-human answer", async () => {
    watching({ maxRepliesPerItem: 1 });
    conversation(1);
    const { runConductor } = await import("../../src/commands/conductor.js");
    expect(await runConductor({ dryRun: true })).toBe(0);
    expect(mockRunClaude).not.toHaveBeenCalled();
    watching();
    conversation(0);
    mockRunClaude.mockImplementation(printed("NEEDS-HUMAN: stuck"));
    expect(await runConductor({ dryRun: true })).toBe(0);
    expect(mockAddLabel).not.toHaveBeenCalled();
    expect(stdout).toMatch(/needs a human \(not labelled\): stuck/);
  });
});

describe("conductor --automatic", () => {
  async function runWith(options: object): Promise<number> {
    const { runConductor } = await import("../../src/commands/conductor.js");
    return runConductor(options);
  }

  it("rejects --interval without --automatic", async () => {
    expect(await runWith({ interval: "5" })).toBe(1);
    expect(stderr).toMatch(/--interval needs --automatic/);
  });

  it("rejects --automatic with --check or --dry-run, and a bad interval", async () => {
    expect(await runWith({ automatic: true, check: true })).toBe(1);
    expect(await runWith({ automatic: true, dryRun: true })).toBe(1);
    expect(stderr).toMatch(/--automatic cannot be used with --check or --dry-run/);
    expect(await runWith({ automatic: true, interval: "0" })).toBe(1);
    expect(stderr).toMatch(/--interval must be a positive whole number/);
    expect(mockAcquire).not.toHaveBeenCalled();
  });

  it("exits 0 at once when the watch list is empty", async () => {
    expect(await runWith({ automatic: true, interval: "1" })).toBe(0);
    expect(mockAcquire).toHaveBeenCalledOnce();
    expect(stdout).toMatch(/leaving the loop/);
  });

  it("waits, then leaves once the last watched item is closed", async () => {
    vi.useFakeTimers();
    try {
      watchState = [7];
      mockTarget.mockReturnValueOnce(issue(7));
      mockTarget.mockReturnValue({ ...issue(7), state: "closed" });
      const done = runWith({ automatic: true, interval: "3" });
      await vi.advanceTimersByTimeAsync(3000);
      expect(await done).toBe(0);
      expect(mockAcquire).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits with a Copilot-only turn while the do-work lock is held", async () => {
    watchState = [9];
    mockTarget.mockReturnValue({ ...issue(9), kind: "pr" });
    mockPrSurface.mockReturnValue({
      pr: { number: 9, title: "T", url: "u", state: "OPEN", isDraft: false, headRefName: "f", baseRefName: "develop" },
      assignees: [],
      messages: [],
      threads: [{ path: "a.ts", line: 1, isResolved: false, url: null, comments: [{ kind: "thread-comment", author: "Copilot", body: "fix", createdAt: "2026-10-01T10:00:00Z" }] }],
    });
    mockInspectRun.mockReturnValue({ kind: "held", owner: { pid: 1 }, heldForMs: 1 });
    expect(await runWith({})).toBe(0);
    expect(stdout).toMatch(/agent is working/);
    expect(mockRunClaude).not.toHaveBeenCalled();

    mockInspectRun.mockReturnValue({ kind: "free" });
    mockRunClaude.mockResolvedValue(undefined);
    await runWith({});
    expect(mockRunClaude).toHaveBeenCalledOnce();
  });
});

describe("conductor rebase check", () => {
  const SHA = "abc1234def";
  const MARK = "<!-- automata:conductor -->";
  const rebaseMark = (sha: string) => `<!-- automata:conductor-rebase head=${sha} -->`;
  const comment = (author: string, at: string, body: string) => ({ kind: "pr-comment", author, body, createdAt: at });

  function watchingPr(mergeable: string, messages: unknown[], labels: string[] = ["conductor-blocked"], extra: object = {}) {
    watchState = [9];
    const config = { ...CONFIG, conductor: { ...extra } };
    mockReadConfig.mockReturnValue(config);
    mockRawConfig.mockReturnValue(config);
    mockTarget.mockReturnValue({ ...issue(9), kind: "pr", labels });
    mockPrSurface.mockImplementation(() => ({
      pr: { number: 9, title: "T", url: "u", state: "OPEN", isDraft: false, headRefName: "f", baseRefName: "develop", mergeable, headSha: SHA },
      assignees: [],
      messages,
      threads: [],
    }));
  }
  const spoke = [comment("alice", "2026-10-01T09:00:00Z", "go")];

  it("rebases a blocked pull request with a conflict, with the configured prompt and the rebase marker", async () => {
    watchingPr("CONFLICTING", spoke, ["conductor-blocked"], { prompts: { rebase: "REBASE NOW" } });
    mockRunClaude.mockResolvedValue(undefined);
    await run();
    expect(mockRunClaude).toHaveBeenCalledOnce();
    const [prompt] = mockRunClaude.mock.calls[0] as [string];
    expect(prompt.startsWith("REBASE NOW")).toBe(true);
    expect(prompt).toContain("gh pr comment 9 --body-file -");
    expect(prompt).toContain(rebaseMark(SHA));
    expect(stdout).toMatch(/needs a rebase request on pull request #9/);
  });

  it("uses the default prompt of the issue", async () => {
    watchingPr("CONFLICTING", spoke);
    mockRunClaude.mockResolvedValue(undefined);
    await run();
    expect((mockRunClaude.mock.calls[0] as [string])[0]).toMatch(/^please fetch, update the target branch then rebase/);
  });

  it.each(["UNKNOWN", "MERGEABLE"])("does not rebase when mergeable is %s", async (mergeable) => {
    watchingPr(mergeable, spoke);
    await run();
    expect(mockRunClaude).not.toHaveBeenCalled();
  });

  it("ignores a rebase marker written by an account other than the agent", async () => {
    watchingPr("CONFLICTING", [...spoke, comment("mallory", "2026-10-01T10:00:00Z", `rebase\n${rebaseMark(SHA)}`)]);
    mockRunClaude.mockResolvedValue(undefined);
    await run();
    expect(mockRunClaude).toHaveBeenCalledOnce();
  });

  it("runs at most once per head commit", async () => {
    watchingPr("CONFLICTING", [...spoke, comment("alice", "2026-10-01T10:00:00Z", `rebase\n${rebaseMark(SHA)}`), comment("alice", "2026-10-01T11:00:00Z", "ok")]);
    await run();
    expect(mockRunClaude).not.toHaveBeenCalled();
    expect(stdout).toMatch(/already requested for head commit abc1234/);
  });

  it("has its own limit: replies do not use it up, and rebases do not use up the replies", async () => {
    const replies = [1, 2].map((i) => comment("alice", `2026-10-02T0${String(i)}:00:00Z`, `r\n${MARK}`));
    watchingPr("CONFLICTING", [...spoke, ...replies], ["conductor-blocked"], { maxRepliesPerItem: 2 });
    mockRunClaude.mockResolvedValue(undefined);
    await run();
    expect(mockRunClaude).toHaveBeenCalledOnce();

    mockRunClaude.mockClear();
    const rebases = [1, 2].map((i) => comment("alice", `2026-10-02T0${String(i)}:00:00Z`, `r\n${rebaseMark(`old${String(i)}`)}`));
    const answer = comment("alice", "2026-10-03T00:00:00Z", "ok");
    watchingPr("CONFLICTING", [...spoke, ...rebases, answer], ["conductor-blocked"], { maxRepliesPerItem: 2 });
    await run();
    expect(mockRunClaude).not.toHaveBeenCalled();
    expect(stdout).toMatch(/already asked for 2 rebases/);
  });

  it("labels the item again and records the head commit when the rebase run needs a human", async () => {
    mockAddLabel.mockReset();
    watchingPr("CONFLICTING", spoke);
    mockRunClaude.mockImplementation((_prompt: string, options: { sink?: { output: (s: "stdout", t: string) => void } }) => {
      options.sink?.output("stdout", JSON.stringify({ type: "result", result: "NEEDS-HUMAN: the conflict is a design choice" }) + "\n");
      return Promise.resolve();
    });
    expect(await run()).toBe(0);
    expect(mockAddLabel).toHaveBeenCalledWith(expect.objectContaining({ number: 9 }), "conductor-blocked", expect.any(String));
    expect(mockPostMarker).toHaveBeenCalledWith("pr", 9, expect.stringContaining(rebaseMark(SHA)));
  });

  it("waits while the do-work lock is held", async () => {
    watchingPr("CONFLICTING", spoke);
    mockInspectRun.mockReturnValue({ kind: "held", owner: { pid: 1 }, heldForMs: 1 });
    await run();
    expect(stdout).toMatch(/has a merge conflict, but the agent is working/);
    expect(mockRunClaude).not.toHaveBeenCalled();
  });
});

describe("conductor CI-fix check", () => {
  const SHA = "abc1234def";
  const fixMark = (sha: string) => `<!-- automata:conductor-ci-fix head=${sha} -->`;
  const comment = (author: string, at: string, body: string) => ({ kind: "pr-comment", author, body, createdAt: at });
  const spoke = [comment("alice", "2026-10-01T09:00:00Z", "go")];
  const FAILED = [{ name: "build", status: "COMPLETED", conclusion: "FAILURE" }];

  function watchingPr(checks: unknown[], messages: unknown[] = spoke, extra: object = {}, mergeable = "MERGEABLE") {
    watchState = [9];
    const config = { ...CONFIG, conductor: { ...extra } };
    mockReadConfig.mockReturnValue(config);
    mockRawConfig.mockReturnValue(config);
    mockTarget.mockReturnValue({ ...issue(9), kind: "pr", labels: ["conductor-blocked"] });
    mockChecks.mockReturnValue(checks);
    mockPrSurface.mockImplementation(() => ({
      pr: { number: 9, title: "T", url: "u", state: "OPEN", isDraft: false, headRefName: "f", baseRefName: "develop", mergeable, headSha: SHA },
      assignees: [],
      messages,
      threads: [],
    }));
  }

  it("asks for a fix on a blocked pull request, with the configured prompt and the CI-fix marker", async () => {
    watchingPr(FAILED, spoke, { prompts: { ciFix: "FIX THE BUILD" } });
    mockRunClaude.mockResolvedValue(undefined);
    await run();
    expect(mockRunClaude).toHaveBeenCalledOnce();
    const [prompt] = mockRunClaude.mock.calls[0] as [string];
    expect(prompt.startsWith("FIX THE BUILD")).toBe(true);
    expect(prompt).toContain("gh pr comment 9 --body-file -");
    expect(prompt).toContain(fixMark(SHA));
    expect(stdout).toMatch(/needs a CI-fix request on pull request #9/);
  });

  it("uses the default prompt", async () => {
    watchingPr(FAILED);
    mockRunClaude.mockResolvedValue(undefined);
    await run();
    expect((mockRunClaude.mock.calls[0] as [string])[0]).toMatch(/^A check failed on this pull request/);
  });

  it.each([
    ["all checks pass", [{ name: "build", status: "COMPLETED", conclusion: "SUCCESS" }]],
    ["a check is pending", [...FAILED, { name: "sonar", status: "IN_PROGRESS", conclusion: null }]],
    ["there are no checks", []],
  ])("does nothing when %s", async (_name, checks) => {
    watchingPr(checks);
    await run();
    expect(mockRunClaude).not.toHaveBeenCalled();
  });

  it("does nothing when conductor.ciFix.enabled is false", async () => {
    watchingPr(FAILED, spoke, { ciFix: { enabled: false } });
    await run();
    expect(mockRunClaude).not.toHaveBeenCalled();
  });

  it("asks for the rebase first on a conflicting pull request", async () => {
    watchingPr(FAILED, spoke, {}, "CONFLICTING");
    mockRunClaude.mockResolvedValue(undefined);
    await run();
    expect((mockRunClaude.mock.calls[0] as [string])[0]).toMatch(/^please fetch, update the target branch then rebase/);
  });

  it("runs at most once per head commit", async () => {
    watchingPr(FAILED, [...spoke, comment("alice", "2026-10-01T10:00:00Z", `fix\n${fixMark(SHA)}`), comment("alice", "2026-10-01T11:00:00Z", "ok")]);
    await run();
    expect(mockRunClaude).not.toHaveBeenCalled();
    expect(stdout).toMatch(/fix was already requested for head commit abc1234/);
  });

  it("has its own limit", async () => {
    const fixes = [1, 2].map((i) => comment("alice", `2026-10-02T0${String(i)}:00:00Z`, `f\n${fixMark(`old${String(i)}`)}`));
    watchingPr(FAILED, [...spoke, ...fixes, comment("alice", "2026-10-03T00:00:00Z", "ok")], { maxRepliesPerItem: 2 });
    await run();
    expect(mockRunClaude).not.toHaveBeenCalled();
    expect(stdout).toMatch(/already asked for 2 fixes/);
  });

  it("labels the item again and records the head commit when the run needs a human", async () => {
    mockAddLabel.mockReset();
    watchingPr(FAILED);
    mockRunClaude.mockImplementation((_prompt: string, options: { sink?: { output: (s: "stdout", t: string) => void } }) => {
      options.sink?.output("stdout", JSON.stringify({ type: "result", result: "NEEDS-HUMAN: a secret is missing" }) + "\n");
      return Promise.resolve();
    });
    expect(await run()).toBe(0);
    expect(mockAddLabel).toHaveBeenCalledWith(expect.objectContaining({ number: 9 }), "conductor-blocked", expect.any(String));
    expect(mockPostMarker).toHaveBeenCalledWith("pr", 9, expect.stringContaining(fixMark(SHA)));
  });

  it("waits while the do-work lock is held", async () => {
    watchingPr(FAILED);
    mockInspectRun.mockReturnValue({ kind: "held", owner: { pid: 1 }, heldForMs: 1 });
    await run();
    expect(stdout).toMatch(/has a failed check, but the agent is working/);
    expect(mockRunClaude).not.toHaveBeenCalled();
  });
});

describe("conductor stories", () => {
  const sub = (number: number, patch: Record<string, unknown> = {}) => ({
    number, title: `C${String(number)}`, state: "open", labels: [], assignees: [], ...patch,
  });
  const story = (children: unknown[], state = "open") => ({ via: "sub-issues", state, title: "Epic", children });

  beforeEach(() => {
    mockApply.mockReset();
    mockReadConfig.mockReturnValue({ ...CONFIG, issueDiscoveryTechnique: "label", issueDiscoveryValue: "automata" });
  });

  async function runWith(options: { check?: boolean; dryRun?: boolean } = {}): Promise<number> {
    const { runConductor } = await import("../../src/commands/conductor.js");
    return runConductor(options);
  }

  it("add stores a parent with children as a story and does not label the parent", async () => {
    mockTarget.mockReturnValue(issue(10));
    mockStorySource.mockReturnValue(story([sub(11, { state: "closed" }), sub(12)]));
    const { runWatchAdd } = await import("../../src/commands/conductor.js");
    expect(runWatchAdd("10")).toBe(0);
    expect(storyState).toEqual([10]);
    expect(mockApply).not.toHaveBeenCalled();
    expect(mockWriteWatch).not.toHaveBeenCalled();
    expect(stdout).toMatch(/story #10 \(Epic\): 2 children via sub-issues; first open child is #12/);
  });

  it("add refuses title-contains for a story and stores nothing", async () => {
    mockRawConfig.mockReturnValue({ ...CONFIG, issueDiscoveryTechnique: "title-contains" });
    mockTarget.mockReturnValue(issue(10));
    mockStorySource.mockReturnValue(story([sub(11)]));
    const { runWatchAdd } = await import("../../src/commands/conductor.js");
    expect(runWatchAdd("10")).toBe(1);
    expect(storyState).toEqual([]);
  });

  it("remove drops a story", async () => {
    storyState = [10, 20];
    const { runWatchRemove } = await import("../../src/commands/conductor.js");
    expect(runWatchRemove("10")).toBe(0);
    expect(storyState).toEqual([20]);
  });

  it("a tick starts the first open child with the discovery label", async () => {
    storyState = [10];
    mockStorySource.mockReturnValue(story([sub(11, { state: "closed" }), sub(12), sub(13)]));
    expect(await runWith()).toBe(0);
    expect(mockApply).toHaveBeenCalledOnce();
    expect(mockApply).toHaveBeenCalledWith(expect.objectContaining({ number: 12, kind: "issue" }), "label", "automata");
    expect(mockCommentOnIssue).toHaveBeenCalledWith(12, expect.stringContaining("story #10"));
    expect(storyState).toEqual([10]);
  });

  it("add promotes a watched parent: its ordinary watch entry is removed", async () => {
    watchState = [10, 7];
    mockTarget.mockReturnValue(issue(10));
    mockStorySource.mockReturnValue(story([sub(12)]));
    const { runWatchAdd } = await import("../../src/commands/conductor.js");
    expect(runWatchAdd("10")).toBe(0);
    expect(storyState).toEqual([10]);
    expect(watchState).toEqual([7]);
  });

  it("a tick waits while the child has an open pull request, or was started", async () => {
    storyState = [10];
    mockStorySource.mockReturnValue(story([sub(12)]));
    mockLinks.mockReturnValue({ byIssue: new Map([[12, [{ number: 40 }]]]) });
    expect(await runWith()).toBe(0);
    mockLinks.mockReturnValue({ byIssue: new Map() });
    mockStorySource.mockReturnValue(story([sub(12, { labels: ["automata"] })]));
    expect(await runWith()).toBe(0);
    expect(mockApply).not.toHaveBeenCalled();
    expect(mockPostMarker).not.toHaveBeenCalled();
    // The started child goes through the ordinary conductor processing.
    expect(`${stdout}${stderr}`).toMatch(/#12/);
  });

  it("a failed label leaves the child startable: the comment came first, so a retry repeats both", async () => {
    storyState = [10];
    mockStorySource.mockReturnValue(story([sub(12)]));
    mockApply.mockImplementationOnce(() => {
      throw new Error("label failed");
    });
    expect(await runWith()).toBe(1);
    expect(mockCommentOnIssue).toHaveBeenCalledOnce();
    expect(await runWith()).toBe(0);
    expect(mockApply).toHaveBeenCalledTimes(2);
  });

  it("a failed comment applies no label, so the child stays next", async () => {
    storyState = [10];
    mockStorySource.mockReturnValue(story([sub(12)]));
    mockCommentOnIssue.mockImplementationOnce(() => {
      throw new Error("comment failed");
    });
    expect(await runWith()).toBe(1);
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("a watched pull request of a blocked child gets no ordinary processing", async () => {
    storyState = [10];
    watchState = [40];
    mockTarget.mockImplementation((id: number) => ({ ...issue(id), kind: id === 40 ? "pr" : "issue" }));
    mockStorySource.mockReturnValue(story([sub(12, { labels: ["conductor-blocked"] })]));
    mockLinks.mockReturnValue({ byIssue: new Map([[12, [{ number: 40 }]]]) });
    expect(await runWith()).toBe(0);
    expect(stdout).toMatch(/#40 is covered by watched issue #12/);
    expect(mockRunClaude).not.toHaveBeenCalled();
  });

  it("a tick leaves a blocked story alone, silently", async () => {
    storyState = [10];
    mockStorySource.mockReturnValue(story([sub(12, { labels: ["conductor-blocked"] }), sub(13)]));
    expect(await runWith()).toBe(0);
    expect(mockApply).not.toHaveBeenCalled();
    expect(mockCloseIssue).not.toHaveBeenCalled();
    expect(stdout).toMatch(/child #12 is blocked/);
  });

  it("a tick closes a finished story with a comment and drops it", async () => {
    storyState = [10];
    mockStorySource.mockReturnValue(story([sub(11, { state: "closed" })]));
    expect(await runWith()).toBe(0);
    expect(mockCloseIssue).toHaveBeenCalledWith(10, expect.stringMatching(/All 1 child issues are closed/));
    expect(storyState).toEqual([]);
  });

  it("a tick drops a closed parent and keeps a story that cannot be read", async () => {
    storyState = [10, 20];
    mockStorySource.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(await runWith()).toBe(1);
    expect(storyState).toEqual([10, 20]);
    mockStorySource.mockReturnValue(story([sub(11)], "closed"));
    expect(await runWith()).toBe(0);
    expect(storyState).toEqual([]);
  });

  it("a dry run and --check change nothing", async () => {
    storyState = [10];
    mockStorySource.mockReturnValue(story([sub(12)]));
    expect(await runWith({ dryRun: true })).toBe(0);
    expect(stdout).toMatch(/a tick would start child #12/);
    expect(await runWith({ check: true })).toBe(0);
    expect(stdout).toMatch(/Stories \(1\)[\s\S]*child #12 is next/);
    expect(mockApply).not.toHaveBeenCalled();
    expect(mockCloseIssue).not.toHaveBeenCalled();
  });

  it("list shows a story with its children", async () => {
    storyState = [10];
    mockStorySource.mockReturnValue(story([sub(11, { state: "closed" }), sub(12), sub(13)]));
    const { runWatchList } = await import("../../src/commands/conductor.js");
    expect(runWatchList()).toBe(0);
    expect(stdout).toMatch(/story #10 \(open, 3 children via sub-issues\): Epic\n  #11 closed: C11\n  #12 next: C12\n  #13 queued: C13/);
  });
});
