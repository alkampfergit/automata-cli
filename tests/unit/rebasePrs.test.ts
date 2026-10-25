import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  blockedComment,
  buildConflictPrompt,
  decideSkip,
  describeOutcome,
  exitCodeFor,
  hasConflictMarkers,
  rebasePullRequests,
  REBASE_BLOCKED_LABEL,
  type OpenPr,
  type PrOutcome,
  type RebaseDeps,
  type RebaseOptions,
} from "../../src/git/rebasePrs.js";

function pr(overrides: Partial<OpenPr> = {}): OpenPr {
  return {
    number: 1,
    title: "A change",
    headRefName: "feature/a",
    baseRefName: "develop",
    isDraft: false,
    isCrossRepository: false,
    author: "bot",
    labels: [],
    ...overrides,
  };
}

const OPTIONS: RebaseOptions = {
  dryRun: false,
  includeDrafts: false,
  owners: ["bot"],
  maxAttempts: 3,
  prompt: "Resolve.",
  maxPrs: 0,
};

describe("decideSkip", () => {
  it("accepts an owned, non-draft, same-repository pull request", () => {
    expect(decideSkip(pr(), OPTIONS)).toBeNull();
  });
  it("skips forks, drafts and branches that are not owned", () => {
    expect(decideSkip(pr({ isCrossRepository: true }), OPTIONS)).toBe("fork");
    expect(decideSkip(pr({ isDraft: true }), OPTIONS)).toBe("draft");
    expect(decideSkip(pr({ author: "someone" }), OPTIONS)).toBe("not-owned");
  });
  it("accepts a draft when drafts are included", () => {
    expect(decideSkip(pr({ isDraft: true }), { ...OPTIONS, includeDrafts: true })).toBeNull();
  });
});

describe("hasConflictMarkers", () => {
  it("finds an opening or closing marker", () => {
    expect(hasConflictMarkers("a\n<<<<<<< HEAD\nb\n")).toBe(true);
    expect(hasConflictMarkers("a\n>>>>>>> abc123\n")).toBe(true);
  });
  it("ignores a Markdown heading underline and inline text", () => {
    expect(hasConflictMarkers("Title\n=======\nText with <<<<<<< inside\n")).toBe(false);
  });
});

describe("text", () => {
  it("lists the files and the attempt in the prompt", () => {
    const text = buildConflictPrompt("Resolve.", pr(), ["a.txt", "b.txt"], 2, 3);
    expect(text).toContain("Resolve.");
    expect(text).toContain("- a.txt\n- b.txt");
    expect(text).toContain("Attempt 2 of 3");
  });
  it("names the reason in the comment and keeps the tail of the detail", () => {
    const text = blockedComment(pr(), "test-failed", "x".repeat(3000) + "END");
    expect(text).toContain("The test command failed");
    expect(text).toContain("END");
    expect(text.length).toBeLessThan(2000);
  });
  it("exits 1 for a blocked or failed outcome only", () => {
    const ok: PrOutcome = { pr: pr(), status: "rebased", conflictsResolved: 0 };
    expect(exitCodeFor([ok])).toBe(0);
    expect(exitCodeFor([ok, { pr: pr(), status: "failed", detail: "x" }])).toBe(1);
    expect(describeOutcome({ pr: pr(), status: "skipped", reason: "draft" })).toBe("#1 feature/a: skipped (draft)");
  });
});

describe("rebasePullRequests with a real git repository", () => {
  let root: string;
  let work: string;
  let remote: string;
  let notices: { number: number; comment: string }[];
  let cleared: number[];
  let prompts: { prompt: string; cwd: string }[];
  let resolver: (cwd: string) => void;
  let testResult: { ok: boolean; output: string };
  let tempDirs: string[];
  let previousCwd: string;

  function git(cwd: string, ...args: string[]): string {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  }
  function commitFile(cwd: string, file: string, content: string, message: string): void {
    writeFileSync(join(cwd, file), content);
    git(cwd, "add", "-A");
    git(cwd, "commit", "--quiet", "-m", message);
  }
  function branchFromDevelop(name: string, file: string, content: string): void {
    git(work, "checkout", "--quiet", "-b", name, "develop");
    commitFile(work, file, content, `work on ${name}`);
    git(work, "push", "--quiet", "origin", name);
    git(work, "checkout", "--quiet", "develop");
  }
  function advanceDevelop(file: string, content: string): void {
    commitFile(work, file, content, "advance develop");
    git(work, "push", "--quiet", "origin", "develop");
    git(work, "fetch", "--quiet", "origin");
  }
  function remoteSha(branch: string): string {
    return git(remote, "rev-parse", branch).trim();
  }

  const deps = (): RebaseDeps => ({
    git: (args, cwd) => {
      const r = spawnSync("git", args, { cwd: cwd ?? work, encoding: "utf8" });
      return { ok: r.status === 0, stdout: r.stdout, stderr: r.stderr };
    },
    makeTempDir: () => {
      const dir = mkdtempSync(join(tmpdir(), "automata-rebase-test-"));
      tempDirs.push(dir);
      return dir;
    },
    removeTempDir: (path) => rmSync(path, { recursive: true, force: true }),
    readText: (path) => readFileSync(path, "utf8"),
    runModel: (prompt, cwd) => {
      prompts.push({ prompt, cwd });
      resolver(cwd);
      return Promise.resolve();
    },
    runTest: () => testResult,
    notifyBlocked: (p, comment) => {
      notices.push({ number: p.number, comment });
    },
    clearBlocked: (p) => {
      cleared.push(p.number);
    },
  });

  beforeEach(() => {
    previousCwd = process.cwd();
    root = mkdtempSync(join(tmpdir(), "automata-rebase-prs-"));
    remote = join(root, "remote.git");
    work = join(root, "work");
    tempDirs = [];
    notices = [];
    cleared = [];
    prompts = [];
    testResult = { ok: true, output: "" };
    resolver = () => undefined;
    git(root, "init", "--quiet", "--bare", "--initial-branch", "develop", remote);
    git(root, "clone", "--quiet", remote, work);
    git(work, "config", "user.email", "test@example.com");
    git(work, "config", "user.name", "test");
    commitFile(work, "shared.txt", "one\n", "base");
    git(work, "push", "--quiet", "origin", "HEAD:refs/heads/develop");
  });

  afterEach(() => {
    process.chdir(previousCwd);
    rmSync(root, { recursive: true, force: true });
  });

  it("skips an up-to-date pull request", async () => {
    branchFromDevelop("feature/a", "a.txt", "a\n");
    git(work, "fetch", "--quiet", "origin");
    const [outcome] = await rebasePullRequests([pr()], OPTIONS, deps());
    expect(outcome).toMatchObject({ status: "skipped", reason: "up-to-date" });
  });

  it("pushes a clean rebase and leaves the main checkout alone", async () => {
    branchFromDevelop("feature/a", "a.txt", "a\n");
    advanceDevelop("other.txt", "other\n");
    const before = git(work, "rev-parse", "HEAD").trim();
    const [outcome] = await rebasePullRequests([pr()], OPTIONS, deps());
    expect(outcome).toMatchObject({ status: "rebased", conflictsResolved: 0 });
    expect(git(remote, "merge-base", "--is-ancestor", "develop", "feature/a")).toBe("");
    expect(git(work, "rev-parse", "HEAD").trim()).toBe(before);
    expect(git(work, "worktree", "list").trim().split("\n")).toHaveLength(1);
    expect(prompts).toHaveLength(0);
  });

  it("reports a dry run and pushes nothing", async () => {
    branchFromDevelop("feature/a", "a.txt", "a\n");
    advanceDevelop("other.txt", "other\n");
    const tip = remoteSha("feature/a");
    const [outcome] = await rebasePullRequests([pr()], { ...OPTIONS, dryRun: true }, deps());
    expect(outcome.status).toBe("would-rebase");
    expect(remoteSha("feature/a")).toBe(tip);
  });

  it("lets the model resolve a conflict, then pushes", async () => {
    branchFromDevelop("feature/a", "shared.txt", "branch\n");
    advanceDevelop("shared.txt", "develop\n");
    resolver = (cwd) => writeFileSync(join(cwd, "shared.txt"), "merged\n");
    const [outcome] = await rebasePullRequests([pr()], OPTIONS, deps());
    expect(outcome).toMatchObject({ status: "rebased", conflictsResolved: 1 });
    expect(prompts[0].prompt).toContain("- shared.txt");
    expect(git(remote, "show", "feature/a:shared.txt")).toBe("merged\n");
    expect(git(remote, "merge-base", "--is-ancestor", "develop", "feature/a")).toBe("");
  });

  it("blocks when the model leaves a conflict marker, and leaves the branch untouched", async () => {
    branchFromDevelop("feature/a", "shared.txt", "branch\n");
    advanceDevelop("shared.txt", "develop\n");
    const tip = remoteSha("feature/a");
    const [outcome] = await rebasePullRequests([pr()], OPTIONS, deps());
    expect(outcome).toMatchObject({ status: "blocked", reason: "markers-left" });
    expect(remoteSha("feature/a")).toBe(tip);
    expect(notices).toHaveLength(1);
    expect(notices[0].comment).toContain("conflict markers");
    expect(git(work, "worktree", "list").trim().split("\n")).toHaveLength(1);
  });

  it("does not comment again on a pull request that already has the label", async () => {
    branchFromDevelop("feature/a", "shared.txt", "branch\n");
    advanceDevelop("shared.txt", "develop\n");
    const [outcome] = await rebasePullRequests([pr({ labels: [REBASE_BLOCKED_LABEL] })], OPTIONS, deps());
    expect(outcome.status).toBe("blocked");
    expect(notices).toHaveLength(0);
  });

  it("blocks when the executor fails", async () => {
    branchFromDevelop("feature/a", "shared.txt", "branch\n");
    advanceDevelop("shared.txt", "develop\n");
    const failing = deps();
    failing.runModel = () => Promise.reject(new Error("exit 1"));
    const [outcome] = await rebasePullRequests([pr()], OPTIONS, failing);
    expect(outcome).toMatchObject({ status: "blocked", reason: "executor-failed", detail: "exit 1" });
  });

  it("blocks when the test command fails and does not push", async () => {
    branchFromDevelop("feature/a", "a.txt", "a\n");
    advanceDevelop("other.txt", "other\n");
    const tip = remoteSha("feature/a");
    testResult = { ok: false, output: "1 failed" };
    const [outcome] = await rebasePullRequests([pr()], { ...OPTIONS, testCommand: "npm test" }, deps());
    expect(outcome).toMatchObject({ status: "blocked", reason: "test-failed", detail: "1 failed" });
    expect(remoteSha("feature/a")).toBe(tip);
  });

  it("stops at the attempt limit", async () => {
    git(work, "checkout", "--quiet", "-b", "feature/a", "develop");
    commitFile(work, "shared.txt", "b1\n", "first");
    commitFile(work, "shared.txt", "b2\n", "second");
    git(work, "push", "--quiet", "origin", "feature/a");
    git(work, "checkout", "--quiet", "develop");
    advanceDevelop("shared.txt", "develop\n");
    const tip = remoteSha("feature/a");
    resolver = (cwd) => writeFileSync(join(cwd, "shared.txt"), "merged\n");
    const [outcome] = await rebasePullRequests([pr()], { ...OPTIONS, maxAttempts: 1 }, deps());
    expect(outcome).toMatchObject({ status: "blocked", reason: "attempt-limit" });
    expect(remoteSha("feature/a")).toBe(tip);
  });

  it("clears the label after a successful rebase", async () => {
    branchFromDevelop("feature/a", "a.txt", "a\n");
    advanceDevelop("other.txt", "other\n");
    await rebasePullRequests([pr({ labels: [REBASE_BLOCKED_LABEL] })], OPTIONS, deps());
    expect(cleared).toEqual([1]);
  });

  it("refuses to overwrite a branch pushed since the fetch (lease)", async () => {
    branchFromDevelop("feature/a", "a.txt", "a\n");
    advanceDevelop("other.txt", "other\n");
    const racing = deps();
    const original = racing.git;
    racing.git = (args, cwd) => {
      if (args[0] === "push") {
        git(work, "checkout", "--quiet", "-B", "racer", "origin/feature/a");
        commitFile(work, "racer.txt", "x\n", "racer");
        git(work, "push", "--quiet", "origin", "racer:feature/a");
        git(work, "checkout", "--quiet", "develop");
      }
      return original(args, cwd);
    };
    const [outcome] = await rebasePullRequests([pr()], OPTIONS, racing);
    expect(outcome.status).toBe("failed");
  });

  it("isolates a failing pull request and honours --max-prs", async () => {
    branchFromDevelop("feature/a", "a.txt", "a\n");
    branchFromDevelop("feature/b", "b.txt", "b\n");
    advanceDevelop("other.txt", "other\n");
    const broken = pr({ number: 1, headRefName: "feature/a" });
    const fine = pr({ number: 2, headRefName: "feature/b" });
    const flaky = deps();
    const original = flaky.git;
    flaky.git = (args, cwd) => {
      if (args[0] === "worktree" && args[1] === "add" && args.at(-1) === remoteSha("feature/a")) throw new Error("boom");
      return original(args, cwd);
    };
    const outcomes = await rebasePullRequests([broken, fine], OPTIONS, flaky);
    expect(outcomes.map((o) => o.status)).toEqual(["failed", "rebased"]);
  });

  it("counts only pull requests that need a rebase against --max-prs", async () => {
    branchFromDevelop("feature/a", "a.txt", "a\n");
    branchFromDevelop("feature/b", "b.txt", "b\n");
    advanceDevelop("other.txt", "other\n");
    const prs = [pr({ number: 3, author: "x" }), pr({ number: 1 }), pr({ number: 2, headRefName: "feature/b" })];
    const outcomes = await rebasePullRequests(prs, { ...OPTIONS, maxPrs: 1 }, deps());
    expect(outcomes.map((o) => `${String(o.pr.number)}:${o.status}`)).toEqual(["3:skipped", "1:rebased"]);
  });
});
