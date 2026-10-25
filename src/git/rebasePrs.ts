import { join } from "node:path";
import { REBASE_STRATEGY_ARGS } from "./gitService.js";

/** The label a pull request carries while `git rebase-prs` waits for a person. */
export const REBASE_BLOCKED_LABEL = "rebase-blocked";
export const REBASE_BLOCKED_LABEL_DESCRIPTION = "automata could not rebase this branch on its own; a person must take over";

export interface OpenPr {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  isCrossRepository: boolean;
  author: string;
  labels: string[];
}

export type SkipReason = "draft" | "fork" | "not-owned" | "ref-missing" | "up-to-date";

export type BlockReason = "attempt-limit" | "markers-left" | "executor-failed" | "test-failed" | "rebase-failed";

export type PrOutcome =
  | { pr: OpenPr; status: "skipped"; reason: SkipReason }
  | { pr: OpenPr; status: "would-rebase" }
  | { pr: OpenPr; status: "rebased"; conflictsResolved: number }
  | { pr: OpenPr; status: "blocked"; reason: BlockReason; detail: string; notifyError?: string }
  | { pr: OpenPr; status: "failed"; detail: string };

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Every side effect of the flow. The real ones are in `rebasePrsService.ts`; a test passes its own. */
export interface RebaseDeps {
  /** Runs `git` in `cwd`, or in the main checkout when `cwd` is undefined. */
  git(args: string[], cwd?: string): GitResult;
  /** A new, empty directory for one worktree. */
  makeTempDir(): string;
  removeTempDir(path: string): void;
  readText(path: string): string;
  /** Runs the executor with `prompt` inside `cwd`. Rejects when the executor fails. */
  runModel(prompt: string, cwd: string): Promise<void>;
  runTest(command: string, cwd: string): { ok: boolean; output: string };
  /** Adds the `rebase-blocked` label and posts the comment. May throw. */
  notifyBlocked(pr: OpenPr, comment: string): void;
  /** Takes the label off after a successful rebase. May throw. */
  clearBlocked(pr: OpenPr): void;
}

export interface RebaseOptions {
  dryRun: boolean;
  includeDrafts: boolean;
  /** Logins whose branches automata may force-push. */
  owners: string[];
  maxAttempts: number;
  testCommand?: string;
  prompt: string;
  /** Stops after this many pull requests needed a rebase. 0 means no limit. */
  maxPrs: number;
}

/** Why a pull request is not rebased before its refs are even read, or null when it may be. */
export function decideSkip(pr: OpenPr, options: Pick<RebaseOptions, "includeDrafts" | "owners">): SkipReason | null {
  if (pr.isCrossRepository) return "fork";
  if (pr.isDraft && !options.includeDrafts) return "draft";
  if (!options.owners.includes(pr.author)) return "not-owned";
  return null;
}

/**
 * Does the text still hold a conflict marker?
 *
 * Only the opening and closing markers count. A bare `=======` line is a valid
 * Markdown heading underline, so matching it would block a correct resolution.
 */
export function hasConflictMarkers(text: string): boolean {
  return /^(<{7}|>{7})( |$)/m.test(text);
}

export function buildConflictPrompt(prompt: string, pr: OpenPr, files: string[], attempt: number, maxAttempts: number): string {
  return [
    prompt.trim(),
    "",
    `Pull request #${String(pr.number)}: ${pr.title}`,
    `Branch ${pr.headRefName} is being rebased onto ${pr.baseRefName}. Attempt ${String(attempt)} of ${String(maxAttempts)}.`,
    "",
    "Conflicted files:",
    ...files.map((file) => `- ${file}`),
  ].join("\n");
}

const REASON_TEXT: Record<BlockReason, string> = {
  "attempt-limit": "The limit of conflict resolutions was reached.",
  "markers-left": "The model left conflict markers in a file.",
  "executor-failed": "The executor failed while it resolved the conflicts.",
  "test-failed": "The test command failed after the rebase.",
  "rebase-failed": "git stopped the rebase and no conflicted file was left to resolve.",
};

export function describeBlockReason(reason: BlockReason): string {
  return REASON_TEXT[reason];
}

export function blockedComment(pr: OpenPr, reason: BlockReason, detail: string): string {
  const lines = [
    `automata could not rebase \`${pr.headRefName}\` onto \`${pr.baseRefName}\` on its own. ${describeBlockReason(reason)}`,
    "The branch is unchanged. A person must rebase it.",
  ];
  const trimmed = detail.trim();
  if (trimmed.length > 0) lines.push("", "```", trimmed.slice(-1500), "```");
  return lines.join("\n");
}

function lines(text: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}

function conflictedFiles(deps: RebaseDeps, worktree: string): string[] {
  return lines(deps.git(["diff", "--name-only", "--diff-filter=U"], worktree).stdout);
}

type RebaseResult =
  | { ok: true; conflictsResolved: number }
  | { ok: false; reason: BlockReason; detail: string };

/** Replays the worktree's branch onto `base`, handing every conflict to the model. */
async function rebaseWithModel(
  pr: OpenPr,
  base: string,
  worktree: string,
  options: RebaseOptions,
  deps: RebaseDeps,
): Promise<RebaseResult> {
  const abort = (reason: BlockReason, detail: string): RebaseResult => {
    deps.git(["rebase", "--abort"], worktree);
    return { ok: false, reason, detail };
  };

  // One round per conflict stop. Recursion, not a loop: each round must wait for the model before the next begins.
  const resolveFrom = async (result: GitResult, attempts: number): Promise<RebaseResult> => {
    if (result.ok) return { ok: true, conflictsResolved: attempts };
    const files = conflictedFiles(deps, worktree);
    if (files.length === 0) return abort("rebase-failed", [result.stdout, result.stderr].join("\n"));
    if (attempts >= options.maxAttempts) return abort("attempt-limit", files.join("\n"));
    try {
      await deps.runModel(buildConflictPrompt(options.prompt, pr, files, attempts + 1, options.maxAttempts), worktree);
    } catch (err) {
      return abort("executor-failed", (err as Error).message);
    }
    const remaining = files.filter((file) => hasConflictMarkers(deps.readText(join(worktree, file))));
    if (remaining.length > 0) return abort("markers-left", remaining.join("\n"));
    deps.git(["add", "-A", "--", ...files], worktree);
    return resolveFrom(deps.git(["-c", "core.editor=true", "rebase", "--continue"], worktree), attempts + 1);
  };

  return resolveFrom(deps.git([...REBASE_STRATEGY_ARGS, base], worktree), 0);
}

function block(pr: OpenPr, reason: BlockReason, detail: string, deps: RebaseDeps): PrOutcome {
  try {
    // A pull request that already waits for a person has been told; a second comment every cron tick is noise.
    if (!pr.labels.includes(REBASE_BLOCKED_LABEL)) deps.notifyBlocked(pr, blockedComment(pr, reason, detail));
    return { pr, status: "blocked", reason, detail };
  } catch (err) {
    return { pr, status: "blocked", reason, detail, notifyError: (err as Error).message };
  }
}

/** Rebases one pull request. Never throws for a git or executor failure; the outcome says what happened. */
export async function rebaseOne(pr: OpenPr, options: RebaseOptions, deps: RebaseDeps): Promise<PrOutcome> {
  const headRef = `refs/remotes/origin/${pr.headRefName}`;
  const base = `origin/${pr.baseRefName}`;
  const headSha = deps.git(["rev-parse", "--verify", "--quiet", headRef]).stdout.trim();
  const baseSha = deps.git(["rev-parse", "--verify", "--quiet", `refs/remotes/${base}`]).stdout.trim();
  if (headSha.length === 0 || baseSha.length === 0) return { pr, status: "skipped", reason: "ref-missing" };
  if (deps.git(["merge-base", "--is-ancestor", baseSha, headSha]).ok) return { pr, status: "skipped", reason: "up-to-date" };
  if (options.dryRun) return { pr, status: "would-rebase" };

  const dir = deps.makeTempDir();
  try {
    const added = deps.git(["worktree", "add", "--detach", dir, headSha]);
    if (!added.ok) return { pr, status: "failed", detail: added.stderr.trim() };
    try {
      const rebased = await rebaseWithModel(pr, base, dir, options, deps);
      if (!rebased.ok) return block(pr, rebased.reason, rebased.detail, deps);

      if (options.testCommand !== undefined) {
        const tested = deps.runTest(options.testCommand, dir);
        if (!tested.ok) return block(pr, "test-failed", tested.output, deps);
      }

      const pushed = deps.git(
        ["push", `--force-with-lease=refs/heads/${pr.headRefName}:${headSha}`, "origin", `HEAD:refs/heads/${pr.headRefName}`],
        dir,
      );
      if (!pushed.ok) return { pr, status: "failed", detail: pushed.stderr.trim() };
      if (pr.labels.includes(REBASE_BLOCKED_LABEL)) {
        try {
          deps.clearBlocked(pr);
        } catch {
          // The branch is already pushed; a stale label is cosmetic.
        }
      }
      return { pr, status: "rebased", conflictsResolved: rebased.conflictsResolved };
    } finally {
      deps.git(["worktree", "remove", "--force", dir]);
    }
  } finally {
    deps.removeTempDir(dir);
  }
}

/**
 * Rebases every pull request that needs it. One pull request that throws is
 * reported as failed and the loop goes on: a cron run must not stop at the
 * first bad branch.
 */
export async function rebasePullRequests(
  prs: OpenPr[],
  options: RebaseOptions,
  deps: RebaseDeps,
  onOutcome: (outcome: PrOutcome) => void = () => undefined,
): Promise<PrOutcome[]> {
  const handle = async (pr: OpenPr): Promise<PrOutcome> => {
    const skip = decideSkip(pr, options);
    if (skip !== null) return { pr, status: "skipped", reason: skip };
    try {
      return await rebaseOne(pr, options, deps);
    } catch (err) {
      return { pr, status: "failed", detail: (err as Error).message };
    }
  };

  // Recursion, not a loop: the pull requests are handled one after the other, never in parallel.
  const next = async (index: number, needed: number, done: PrOutcome[]): Promise<PrOutcome[]> => {
    if (index >= prs.length || (options.maxPrs > 0 && needed >= options.maxPrs)) return done;
    const outcome = await handle(prs[index]);
    onOutcome(outcome);
    return next(index + 1, outcome.status === "skipped" ? needed : needed + 1, [...done, outcome]);
  };

  return next(0, 0, []);
}

function noticeFailure(error: string | undefined): string {
  return error === undefined ? "" : " The notice failed: " + error;
}

export function describeOutcome(outcome: PrOutcome): string {
  const head = `#${String(outcome.pr.number)} ${outcome.pr.headRefName}`;
  switch (outcome.status) {
    case "skipped":
      return `${head}: skipped (${outcome.reason})`;
    case "would-rebase":
      return `${head}: would rebase onto ${outcome.pr.baseRefName}`;
    case "rebased":
      return `${head}: rebased and pushed (${String(outcome.conflictsResolved)} conflict resolution(s))`;
    case "blocked":
      return `${head}: blocked, ${describeBlockReason(outcome.reason)}${noticeFailure(outcome.notifyError)}`;
    case "failed":
      return `${head}: failed, ${outcome.detail}`;
  }
}

/** The exit code: 1 when a pull request was blocked or failed. */
export function exitCodeFor(outcomes: PrOutcome[]): number {
  return outcomes.some((o) => o.status === "blocked" || o.status === "failed") ? 1 : 0;
}
