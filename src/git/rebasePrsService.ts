import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCommand } from "../cli/spawnUtils.js";
import { runClaude } from "../claude/claudeService.js";
import { runCodex } from "../codex/codexService.js";
import type { Executor } from "../config/configStore.js";
import { addLabel, removeLabel } from "../github/ghWorkService.js";
import {
  REBASE_BLOCKED_LABEL,
  REBASE_BLOCKED_LABEL_DESCRIPTION,
  type GitResult,
  type OpenPr,
  type RebaseDeps,
} from "./rebasePrs.js";

const PR_FIELDS = "number,title,headRefName,baseRefName,isDraft,isCrossRepository,author,labels,state";

interface RawPr {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  isCrossRepository: boolean;
  author?: { login?: string } | null;
  labels?: { name: string }[];
  state?: string;
}

function toOpenPr(raw: RawPr): OpenPr {
  return {
    number: raw.number,
    title: raw.title,
    headRefName: raw.headRefName,
    baseRefName: raw.baseRefName,
    isDraft: raw.isDraft,
    isCrossRepository: raw.isCrossRepository,
    author: raw.author?.login ?? "",
    labels: (raw.labels ?? []).map((label) => label.name),
  };
}

function gh(args: string[], input?: string): string {
  const result = spawnSync(resolveCommand("gh"), args, { encoding: "utf8", input });
  if (result.error) throw new Error(`\`gh\` could not run: ${result.error.message}`);
  if (result.status !== 0) throw new Error(result.stderr.trim() || `gh ${args.slice(0, 2).join(" ")} exited ${String(result.status)}`);
  return result.stdout;
}

/** The open pull requests, oldest first, or only `only` when it is given. */
export function listOpenPrs(only?: number): OpenPr[] {
  if (only !== undefined) {
    const raw = JSON.parse(gh(["pr", "view", String(only), "--json", PR_FIELDS])) as RawPr;
    if (raw.state !== "OPEN") throw new Error(`Pull request #${String(only)} is not open.`);
    return [toOpenPr(raw)];
  }
  const raw = JSON.parse(gh(["pr", "list", "--state", "open", "--limit", "200", "--json", PR_FIELDS])) as RawPr[];
  return raw.map(toOpenPr).sort((a, b) => a.number - b.number);
}

export function fetchOrigin(): GitResult {
  return runGit(["fetch", "origin"]);
}

function runGit(args: string[], cwd?: string): GitResult {
  const result = spawnSync(resolveCommand("git"), args, { encoding: "utf8", cwd });
  return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? result.error?.message ?? "" };
}

export interface ExecutorSettings {
  executor: Executor;
  model?: string;
  effort?: string;
}

export function createRebaseDeps(settings: ExecutorSettings): RebaseDeps {
  return {
    git: runGit,
    makeTempDir: () => mkdtempSync(join(tmpdir(), "automata-rebase-")),
    removeTempDir: (path) => rmSync(path, { recursive: true, force: true }),
    readText: (path) => readFileSync(path, "utf8"),
    runModel: (prompt, cwd) =>
      settings.executor === "codex"
        ? runCodex(prompt, { model: settings.model, effort: settings.effort, cwd })
        : runClaude(prompt, { model: settings.model, effort: settings.effort, cwd }),
    runTest: (command, cwd) => {
      const result = spawnSync(command, { shell: true, cwd, encoding: "utf8" });
      return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
    },
    notifyBlocked: (pr, comment) => {
      addLabel({ number: pr.number, kind: "pr" }, REBASE_BLOCKED_LABEL, REBASE_BLOCKED_LABEL_DESCRIPTION);
      gh(["pr", "comment", String(pr.number), "--body-file", "-"], comment);
    },
    clearBlocked: (pr) => removeLabel({ number: pr.number, kind: "pr" }, REBASE_BLOCKED_LABEL),
  };
}
