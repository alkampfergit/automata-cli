import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { preparePrBranch } from "../../src/git/workspaceService.js";

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

  it("refuses a dirty tree before touching anything", () => {
    divergeEquivalently();
    const before = sha("HEAD");
    writeFileSync(join(repo, "base.txt"), "edited by a human\n");

    expect(preparePrBranch(BRANCH)).toMatchObject({ ok: false, reason: "dirty-tree" });
    expect(sha("HEAD")).toBe(before);
  });

  it("lands on a branch this checkout has no local ref for", () => {
    // Worth pinning: `git checkout <branch>` guesses the branch from the single
    // matching remote-tracking ref, so after the fetch it *succeeds* and the
    // explicit `createTrackingBranch` fallback (strategy `tracking-branch`) is
    // only reached when that guess is unavailable. Either way the branch ends up
    // at the remote tip, which is the part that matters.
    const other = "feature/never-seen-here";
    git(repo, "checkout", "--quiet", "-b", "scratch");
    commit("branch work", "s.txt", "s\n");
    git(repo, "push", "--quiet", "origin", `HEAD:refs/heads/${other}`);
    const tip = sha("HEAD");
    git(repo, "checkout", "--quiet", BRANCH);
    git(repo, "branch", "--quiet", "-D", "scratch");

    expect(preparePrBranch(other)).toMatchObject({ ok: true, branch: other });
    expect(sha("HEAD")).toBe(tip);
    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe(other);
  });
});
