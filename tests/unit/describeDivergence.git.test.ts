import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describeDivergence } from "../../src/git/gitService.js";

/**
 * These run against a real `git`, on purpose.
 *
 * `describeDivergence` exists to answer "is every commit this branch has that
 * the remote does not already applied upstream under a different sha?", and the
 * whole answer comes out of `git cherry`'s patch-id comparison. A `spawnSync`
 * mock could only ever confirm the argv we already chose; it cannot tell us
 * that `git cherry` silently omits merge commits, which is the one behaviour
 * the caller's safety argument rests on.
 *
 * The first test reproduces the shape reported in issue #73: two tips with the
 * same parent, the same tree, and different shas.
 */

let repo: string;
let previousCwd: string;

function git(...args: string[]): string {
  // stderr piped, not inherited: one test provokes a git error and its message
  // would otherwise land in the runner's output.
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function commit(file: string, content: string, message: string): string {
  writeFileSync(join(repo, file), content);
  git("add", "-A");
  git("commit", "--quiet", "-m", message);
  return git("rev-parse", "HEAD").trim();
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "automata-divergence-"));
  git("init", "--quiet", "--initial-branch", "work", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  commit("base.txt", "base\n", "base");
  // `upstream` stands in for refs/remotes/origin/<branch>: the caller only ever
  // passes two refs, and a local branch exercises the same comparison.
  git("branch", "upstream");

  previousCwd = process.cwd();
  process.chdir(repo);
});

afterEach(() => {
  process.chdir(previousCwd);
  rmSync(repo, { recursive: true, force: true });
});

describe("describeDivergence against a real git", () => {
  it("marks a commit already applied upstream under a different sha as alreadyUpstream", () => {
    // The remote applied the change first...
    git("checkout", "--quiet", "upstream");
    commit("shared.txt", "one\n", "the change, as the remote recorded it");
    // ...and the local branch recorded the same patch under its own sha.
    git("checkout", "--quiet", "work");
    const local = commit("shared.txt", "one\n", "the change, as this checkout recorded it");

    const report = describeDivergence("upstream", "work");

    expect(report).not.toBeNull();
    expect(report?.merges).toBe(0);
    expect(report?.commits).toEqual([{ sha: local, alreadyUpstream: true }]);
    // The shape from issue #73: same parent, same tree, different commit.
    expect(git("rev-parse", "work^{tree}").trim()).toBe(git("rev-parse", "upstream^{tree}").trim());
    expect(git("rev-parse", "work").trim()).not.toBe(git("rev-parse", "upstream").trim());
  });

  it("marks a commit that exists nowhere upstream as not alreadyUpstream", () => {
    git("checkout", "--quiet", "upstream");
    commit("remote-only.txt", "r\n", "remote work");
    git("checkout", "--quiet", "work");
    const local = commit("local-only.txt", "l\n", "unpushed work");

    const report = describeDivergence("upstream", "work");

    expect(report?.commits).toEqual([{ sha: local, alreadyUpstream: false }]);
    expect(report?.merges).toBe(0);
  });

  it("reports an empty range when the branch has nothing the upstream lacks", () => {
    git("checkout", "--quiet", "upstream");
    commit("ahead.txt", "a\n", "upstream moved ahead");
    git("checkout", "--quiet", "work");

    expect(describeDivergence("upstream", "work")).toEqual({ commits: [], merges: 0 });
  });

  it("counts a merge commit that `git cherry` leaves out of its listing", () => {
    // This is the behaviour the caller's merge guard exists for: the range holds
    // two commits, one of them a merge, and `git cherry` reports only one — so
    // reading `commits` alone would understate what the branch is carrying.
    git("checkout", "--quiet", "-b", "side");
    const sideWork = commit("side.txt", "s\n", "side work");
    git("checkout", "--quiet", "work");
    git("merge", "--quiet", "--no-ff", "side", "-m", "merge side");

    const report = describeDivergence("upstream", "work");

    expect(report?.commits).toEqual([{ sha: sideWork, alreadyUpstream: false }]);
    expect(report?.merges).toBe(1);
    expect(git("rev-list", "--count", "upstream..work").trim()).toBe("2");
  });

  it("returns null when a ref cannot be resolved, rather than an empty range", () => {
    expect(describeDivergence("upstream", "no-such-branch")).toBeNull();
  });
});
