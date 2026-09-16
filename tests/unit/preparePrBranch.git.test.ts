import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { preparePrBranch } from "../../src/git/workspaceService.js";
import { isRebaseInProgress } from "../../src/git/gitService.js";

/**
 * The end-to-end proof for issue #73, against a real `git` and a real remote.
 *
 * The unit tests above mock `gitService`, which pins the sequencing but can only
 * ever confirm the argv we already chose. The defect being fixed was not in the
 * sequencing — it was that a divergence git itself considers reconcilable was
 * being refused forever. So this file builds the reported situation for real: a
 * bare repository as `origin`, a clone whose branch tip and remote tip are
 * different commits with the same parent and the same tree, and a run of
 * `preparePrBranch` over it.
 */

const BRANCH = "copilot/enable-trusted-publishing";

let root: string;
let repo: string;
let previousCwd: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}

function commit(message: string, file: string, content: string): string {
  writeFileSync(join(repo, file), content);
  git(repo, "add", "-A");
  git(repo, "commit", "--quiet", "-m", message);
  return git(repo, "rev-parse", "HEAD").trim();
}

function sha(ref: string): string {
  return git(repo, "rev-parse", ref).trim();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "automata-prepare-"));
  const remote = join(root, "remote.git");
  repo = join(root, "work");
  git(root, "init", "--quiet", "--bare", "--initial-branch", BRANCH, remote);
  git(root, "clone", "--quiet", remote, repo);
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "test");
  // Set hostile on purpose: every strategy is named on the command line, so a
  // machine configured this way must behave exactly like one that is not. The
  // original defect was the opposite — behaviour that followed this key.
  git(repo, "config", "pull.rebase", "false");
  // Same reasoning for the rebase: with this on, git replays the commits
  // `git cherry` reported as already upstream rather than dropping them, so a
  // machine configured this way must still end exactly on the remote tip.
  git(repo, "config", "rebase.reapplyCherryPicks", "true");
  commit("base", "base.txt", "base\n");
  git(repo, "push", "--quiet", "origin", `HEAD:refs/heads/${BRANCH}`);
  git(repo, "checkout", "--quiet", "-B", BRANCH);
  git(repo, "branch", "--quiet", `--set-upstream-to=origin/${BRANCH}`);

  previousCwd = process.cwd();
  process.chdir(repo);
});

afterEach(() => {
  process.chdir(previousCwd);
  rmSync(root, { recursive: true, force: true });
});

/** Put the same patch on the remote and on the local branch under different shas. */
function divergeEquivalently(): void {
  commit("fix sonar", "g.txt", "fix\n");
  git(repo, "push", "--quiet", "origin", `HEAD:refs/heads/${BRANCH}`);
  git(repo, "reset", "--quiet", "--hard", "HEAD~1");
  commit("fix(ci): pin NuGet/login action to full commit SHA", "g.txt", "fix\n");
}

describe("preparePrBranch against a real git remote", () => {
  it("fast-forwards an ordinary branch that is simply behind", () => {
    const upstream = commit("remote work", "r.txt", "r\n");
    git(repo, "push", "--quiet", "origin", `HEAD:refs/heads/${BRANCH}`);
    git(repo, "reset", "--quiet", "--hard", "HEAD~1");

    expect(preparePrBranch(BRANCH)).toEqual({
      ok: true,
      branch: BRANCH,
      strategy: "fast-forward",
    });
    expect(sha("HEAD")).toBe(upstream);
  });

  it("rebases the exact divergence reported in issue #73", () => {
    divergeEquivalently();
    const localBefore = sha("HEAD");
    const remote = git(repo, "ls-remote", "origin", `refs/heads/${BRANCH}`).split(/\s/)[0];
    // The reported shape: different commits, same tree.
    expect(localBefore).not.toBe(remote);
    expect(sha("HEAD^{tree}")).toBe(sha(`${remote}^{tree}`));

    expect(preparePrBranch(BRANCH)).toEqual({ ok: true, branch: BRANCH, strategy: "rebase" });

    expect(sha("HEAD")).toBe(remote);
    expect(git(repo, "status", "--porcelain").trim()).toBe("");
  });

  it("refuses and moves nothing when a local commit is genuinely unpushed", () => {
    commit("remote work", "r.txt", "r\n");
    git(repo, "push", "--quiet", "origin", `HEAD:refs/heads/${BRANCH}`);
    git(repo, "reset", "--quiet", "--hard", "HEAD~1");
    const unpushed = commit("work that exists only here", "local.txt", "l\n");

    const result = preparePrBranch(BRANCH);

    expect(result).toMatchObject({ ok: false, reason: "pull-failed" });
    // The whole safety claim in one assertion: the tip did not move.
    expect(sha("HEAD")).toBe(unpushed);
  });

  it("reports a rebase git refused to start as pull-failed, without moving the branch", () => {
    // The branch qualifies for the rebase, but git never replays anything: the
    // pre-rebase hook rejects it. There is then no halted rebase to abort and
    // no conflict to resolve, so calling it `rebase-conflict` would describe
    // something that did not happen.
    divergeEquivalently();
    const before = sha("HEAD");
    writeFileSync(join(repo, ".git", "hooks", "pre-rebase"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });

    expect(preparePrBranch(BRANCH)).toMatchObject({
      ok: false,
      reason: "pull-failed",
      detail: expect.stringContaining("the rebase never started"),
    });
    expect(sha("HEAD")).toBe(before);
    expect(isRebaseInProgress()).toBe(false);
  });

  it("refuses a rebase that was already in progress rather than aborting it", () => {
    // A halted rebase with a clean tree gets past the cleanliness gate, and git
    // refuses a new one while it is there. Aborting on that refusal would throw
    // away an operator's paused work.
    divergeEquivalently();
    const before = sha("HEAD");
    git(repo, "checkout", "--quiet", "-b", "paused", "HEAD~1");
    writeFileSync(join(repo, "p.txt"), "p\n");
    git(repo, "add", "-A");
    git(repo, "commit", "--quiet", "-m", "paused work");
    const pausedTip = sha("HEAD");
    // `--exec false` stops the rebase after the commit is replayed, with a
    // clean tree and no conflict to resolve.
    expect(() => git(repo, "rebase", "--exec", "false", BRANCH)).toThrow();
    expect(isRebaseInProgress()).toBe(true);

    const result = preparePrBranch(BRANCH);

    expect(result).toMatchObject({
      ok: false,
      reason: "pull-failed",
      detail: expect.stringContaining("automata did not start it"),
    });
    // The paused rebase is still there, untouched, and so is the branch.
    expect(isRebaseInProgress()).toBe(true);
    git(repo, "rebase", "--abort");
    expect(sha("paused")).toBe(pausedTip);
    expect(sha(BRANCH)).toBe(before);
  });

  it("lands exactly on the remote tip even with rebase.reapplyCherryPicks on", () => {
    // The strategy names `--no-reapply-cherry-picks`, so the already-upstream
    // commit is dropped rather than replayed; either way the post-condition is
    // that the branch *is* the remote tip, with nothing left local-only.
    divergeEquivalently();
    const remote = git(repo, "ls-remote", "origin", `refs/heads/${BRANCH}`).split(/\s/)[0];

    expect(preparePrBranch(BRANCH)).toEqual({ ok: true, branch: BRANCH, strategy: "rebase" });

    expect(sha("HEAD")).toBe(remote);
    expect(git(repo, "log", "--oneline", `origin/${BRANCH}..${BRANCH}`).trim()).toBe("");
  });

  it("refuses a dirty tree before touching anything", () => {
    divergeEquivalently();
    const before = sha("HEAD");
    writeFileSync(join(repo, "base.txt"), "edited by a human\n");

    expect(preparePrBranch(BRANCH)).toMatchObject({ ok: false, reason: "dirty-tree" });
    expect(sha("HEAD")).toBe(before);
  });

  it("lands on a branch this checkout has no local ref for", () => {
    // `git checkout <branch>` guesses the branch from the single matching
    // remote-tracking ref, so after the fetch it *succeeds* and the explicit
    // `createTrackingBranch` fallback is only reached when that guess is
    // unavailable. Both are this checkout seeing the branch for the first time,
    // so both report `tracking-branch`: nothing was fast-forwarded.
    const other = "feature/never-seen-here";
    git(repo, "checkout", "--quiet", "-b", "scratch");
    commit("branch work", "s.txt", "s\n");
    git(repo, "push", "--quiet", "origin", `HEAD:refs/heads/${other}`);
    const tip = sha("HEAD");
    git(repo, "checkout", "--quiet", BRANCH);
    git(repo, "branch", "--quiet", "-D", "scratch");

    expect(preparePrBranch(other)).toEqual({
      ok: true,
      branch: other,
      strategy: "tracking-branch",
    });
    expect(sha("HEAD")).toBe(tip);
    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe(other);
  });
});

/**
 * The primitive that tells the two non-zero `git rebase` exits apart. Only a
 * real git can produce a halted rebase, and the whole distinction rests on the
 * state directory it leaves behind.
 */
describe("isRebaseInProgress against a real git", () => {
  it("is false with no rebase, true while one is halted, false again after the abort", () => {
    expect(isRebaseInProgress()).toBe(false);

    // Two branches editing the same line: replaying one onto the other stops
    // on the conflict and leaves the rebase in progress.
    git(repo, "checkout", "--quiet", "-b", "theirs");
    commit("theirs", "c.txt", "theirs\n");
    git(repo, "checkout", "--quiet", BRANCH);
    commit("ours", "c.txt", "ours\n");
    expect(() => git(repo, "rebase", "theirs")).toThrow();

    expect(isRebaseInProgress()).toBe(true);
    git(repo, "rebase", "--abort");
    expect(isRebaseInProgress()).toBe(false);
  });

  it("is true for a rebase the apply backend halted, whichever backend ran it", () => {
    // The merge backend leaves `rebase-merge`, the apply backend `rebase-apply`.
    // Both are rebases and both have something to abort.
    git(repo, "checkout", "--quiet", "-b", "theirs");
    commit("theirs", "c.txt", "theirs\n");
    git(repo, "checkout", "--quiet", BRANCH);
    commit("ours", "c.txt", "ours\n");
    expect(() => git(repo, "-c", "rebase.backend=apply", "rebase", "theirs")).toThrow();

    expect(isRebaseInProgress()).toBe(true);
    git(repo, "rebase", "--abort");
    expect(isRebaseInProgress()).toBe(false);
  });

  it("is false for a halted `git am`, which shares the rebase-apply directory", () => {
    // git reuses `rebase-apply` for an interrupted `git am`, and only the
    // marker file inside distinguishes them. Answering true here would make
    // automata report someone's stopped `git am` as its own rebase conflict and
    // then try to `git rebase --abort` a state that abort cannot clear.
    const patches = join(root, "patches");
    git(repo, "checkout", "--quiet", "-b", "source");
    commit("a patch to apply", "am.txt", "from the patch\n");
    git(repo, "format-patch", "--quiet", "-1", "-o", patches);
    git(repo, "checkout", "--quiet", BRANCH);
    // The same file with other content, so the patch cannot apply cleanly.
    commit("conflicting content", "am.txt", "already here\n");
    expect(() => git(repo, "am", join(patches, "0001-a-patch-to-apply.patch"))).toThrow();

    expect(isRebaseInProgress()).toBe(false);
    git(repo, "am", "--abort");
  });
});
