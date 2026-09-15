import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pathIsIgnored, stageAllExcept } from "../../src/git/gitService.js";
import { RUN_LOCK_RELATIVE_PATH } from "../../src/run/runLock.js";

/**
 * These run against a real `git`, on purpose.
 *
 * The defect in issue #69 was not in our sequencing — it was git refusing a
 * pathspec that names an ignored path, while staging everything anyway and
 * exiting 1. No amount of mocking `spawnSync` can catch that: only git can say
 * what git does. So this file builds a scratch repository that reproduces the
 * reported checkout exactly — a dirty tracked file, an untracked file, and a
 * `.automata/automata.lock` matched by `.gitignore`.
 */

let repo: string;
let previousCwd: string;

function git(...args: string[]): string {
  // stderr piped, not inherited: the last test deliberately provokes a git
  // error and its advice text would otherwise land in the runner's output.
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function staged(): string[] {
  return git("diff", "--cached", "--name-only").trim().split("\n").filter(Boolean).sort();
}

function writeLock(): void {
  mkdirSync(join(repo, ".automata"), { recursive: true });
  writeFileSync(join(repo, RUN_LOCK_RELATIVE_PATH), '{"pid":4242}\n');
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "automata-stage-"));
  git("init", "--quiet", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  writeFileSync(join(repo, "tracked.txt"), "original\n");
  git("add", "-A");
  git("commit", "--quiet", "-m", "init");

  writeFileSync(join(repo, "tracked.txt"), "changed\n");
  writeFileSync(join(repo, "untracked.txt"), "new\n");

  previousCwd = process.cwd();
  process.chdir(repo);
});

afterEach(() => {
  process.chdir(previousCwd);
  rmSync(repo, { recursive: true, force: true });
});

describe("stageAllExcept against a real git", () => {
  it("succeeds and stages the dirty work when the run lock is gitignored", () => {
    writeFileSync(join(repo, ".gitignore"), `${RUN_LOCK_RELATIVE_PATH}\n`);
    git("add", ".gitignore");
    git("commit", "--quiet", "-m", "ignore the run lock");
    writeLock();

    const result = stageAllExcept([RUN_LOCK_RELATIVE_PATH]);

    expect(result.ok).toBe(true);
    expect(result.stderr).toBe("");
    expect(staged()).toEqual(["tracked.txt", "untracked.txt"]);
    expect(staged()).not.toContain(RUN_LOCK_RELATIVE_PATH);
  });

  it("still excludes the run lock in a repository that does not ignore it", () => {
    writeLock();

    const result = stageAllExcept([RUN_LOCK_RELATIVE_PATH]);

    expect(result.ok).toBe(true);
    expect(staged()).toEqual(["tracked.txt", "untracked.txt"]);
  });

  // The exclusion has to survive here or the rescue would commit a pid file.
  it("still excludes a run lock the repository both tracks and ignores", () => {
    writeLock();
    git("add", "-f", RUN_LOCK_RELATIVE_PATH);
    git("commit", "--quiet", "-m", "track the lock");
    writeFileSync(join(repo, ".gitignore"), `${RUN_LOCK_RELATIVE_PATH}\n`);
    git("add", ".gitignore");
    git("commit", "--quiet", "-m", "ignore it too");
    writeFileSync(join(repo, RUN_LOCK_RELATIVE_PATH), '{"pid":9999}\n');

    expect(pathIsIgnored(RUN_LOCK_RELATIVE_PATH)).toBe(false);

    const result = stageAllExcept([RUN_LOCK_RELATIVE_PATH]);

    expect(result.ok).toBe(true);
    expect(staged()).toEqual(["tracked.txt", "untracked.txt"]);
  });

  // Pinning the git behaviour this fix exists for, so a future refactor that
  // reinstates the pathspec cannot pass silently.
  it("documents why: naming an ignored path in the pathspec makes git add fail", () => {
    writeFileSync(join(repo, ".gitignore"), `${RUN_LOCK_RELATIVE_PATH}\n`);
    git("add", ".gitignore");
    git("commit", "--quiet", "-m", "ignore the run lock");
    writeLock();

    expect(() =>
      git("add", "-A", "--", ".", `:(exclude)${RUN_LOCK_RELATIVE_PATH}`),
    ).toThrowError();
  });
});
