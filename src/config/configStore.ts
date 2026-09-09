import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";

export type RemoteType = "gh" | "azdo";

export type IssueDiscoveryTechnique = "label" | "assignee" | "title-contains";

export interface AutomataPrompts {
  sonar?: string;
  fixComments?: string;
  checkIssue?: string;
}

/** The two kinds of turn `do-work` can run on an issue. */
export type TurnKind = "issue-discuss" | "pr-work";

export type Executor = "claude" | "codex";

/**
 * Turn instructions for `do-work`, as prompt text or a `.md` filename inside
 * `.automata/`. These prompts are where a skill gets named — automata itself
 * has no concept of a skill.
 */
export interface DoWorkPrompts {
  issueDiscuss?: string;
  prWork?: string;
}

export interface AutomataDoWorkConfig {
  baseBranch?: string;
  executor?: Executor;
  model?: string;
  /** 0 means unlimited. */
  maxRunsPerTick?: number;
  lockStaleMinutes?: number;
  prompts?: DoWorkPrompts;
}

export interface AutomataConfig {
  remoteType?: RemoteType;
  issueDiscoveryTechnique?: IssueDiscoveryTechnique;
  issueDiscoveryValue?: string;
  claudeSystemPrompt?: string;
  allowedUsers?: string[];
  agentUser?: string;
  prompts?: AutomataPrompts;
  doWork?: AutomataDoWorkConfig;
}

export const DEFAULT_CLAUDE_SYSTEM_PROMPT =
  "You are an expert software engineer. " +
  "Implement the following issue according to the project's existing conventions and style. " +
  "Make minimal, targeted changes that satisfy the requirements. " +
  "Run tests and linting before finishing.";

export const DEFAULT_FIX_COMMENTS_PROMPT =
  "You are an expert software engineer reviewing a pull request. " +
  "Below are the open review comments left by reviewers on this PR. " +
  "Please address each comment by making the appropriate code changes. " +
  "Focus on the reviewer's concerns and make minimal, targeted changes that resolve each comment without altering unrelated code.";

export const DEFAULT_SONAR_PROMPT =
  "You are an expert software engineer. You have been given the URL of a SonarCloud analysis for this pull request. " +
  "If the `sonar-quality-gate` skill is available in this repository, use it. " +
  "The project is public, so use the SonarCloud REST API directly (no authentication required) rather than scraping the URL. " +
  "Inspect both the quality gate and the list of issues for this pull request. " +
  "If the quality gate fails because of duplication or another metric-based condition, use the relevant Sonar APIs to identify the affected files and details instead of relying only on the issues endpoint. " +
  "Fix all new issues and quality-gate failures reported. " +
  "Focus on code smells, bugs, vulnerabilities, and blocking quality-gate conditions flagged in this PR. " +
  "Make targeted, minimal changes that resolve each issue without altering unrelated code.";

export const DEFAULT_CHECK_ISSUE_PROMPT =
  "You are an expert software engineer working on a GitHub issue. " +
  "Below is the conversation on that issue, restricted to the people allowed to instruct you and your own previous replies. " +
  "Messages marked as new arrived after your last run: treat them as the current instruction and read the earlier messages only as context. " +
  "Do what the new messages ask, following the project's existing conventions and style, and make minimal, targeted changes. " +
  "Run tests and linting before finishing, then reply on the issue with a short summary of what you did.";

export const DEFAULT_DO_WORK = {
  baseBranch: "develop",
  executor: "claude" as Executor,
  maxRunsPerTick: 0,
  lockStaleMinutes: 120,
};

/**
 * Default instructions for a discuss turn. States the turn boundary and names
 * no skill, so `do-work` behaves correctly with no plugins installed.
 */
export const DEFAULT_DO_WORK_ISSUE_DISCUSS_PROMPT =
  "You are the agent named in the context below, working on a GitHub issue together with the people allowed to instruct you. " +
  "Answer the messages marked NEW; the earlier messages are context only.\n\n" +
  "Do not modify, create or delete any file, and do not create a branch or a pull request, " +
  "UNLESS a message marked NEW explicitly asks you to implement the work. " +
  "If it does: create a branch off the base branch named below, implement the change following the project's existing conventions, " +
  "run the tests and the linter, and open a pull request whose body contains `Closes #<issue number>`.\n\n" +
  "Otherwise do not touch the code at all: reply on the issue with the specification, the plan, or the open questions you need answered. " +
  "Keep the reply short and concrete, and always post a reply — silence looks like a crash.";

/** Default instructions for a build turn on an existing pull request. */
export const DEFAULT_DO_WORK_PR_WORK_PROMPT =
  "You are the agent named in the context below, working on the pull request for a GitHub issue together with the people allowed to instruct you. " +
  "Work on the branch named below, which is already checked out and up to date.\n\n" +
  "Address every message marked NEW and every unresolved review thread listed. " +
  "Follow the project's existing conventions, run the tests and the linter, then commit and push to that branch. " +
  "Do not merge the pull request and do not push to the base branch.\n\n" +
  "Reply on the pull request with a short summary of what you changed, or reply in the review thread when your answer belongs to a specific comment. " +
  "Always post a reply — silence looks like a crash.";

const CONFIG_DIR = ".automata";
const CONFIG_FILE = "config.json";

function configPath(): string {
  return join(process.cwd(), CONFIG_DIR, CONFIG_FILE);
}

function automataDir(): string {
  return join(process.cwd(), CONFIG_DIR);
}

/**
 * Resolve a prompt config field value.
 * If value ends with ".md", reads the file from dir and returns its contents.
 * Throws if the resolved path escapes dir or the file is missing.
 * Otherwise returns value unchanged.
 */
export function resolvePromptRef(value: string, dir: string): string {
  if (!value.endsWith(".md")) return value;
  if (value.includes("/") || value.includes("\\")) {
    throw new Error(`Prompt file "${value}" must be a plain filename with no subdirectories`);
  }
  const fullPath = resolve(dir, value);
  const safeBase = resolve(dir) + sep;
  if (!fullPath.startsWith(safeBase)) {
    throw new Error(`Prompt file "${value}" resolves outside .automata/`);
  }
  try {
    return readFileSync(fullPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new Error(
        `Prompt file "${value}" not found in "${dir}". Expected path: ${fullPath}`,
        { cause: err }
      );
    }
    throw err;
  }
}

/** Read config.json as-is without resolving .md file references. */
export function readRawConfig(): AutomataConfig {
  try {
    const raw = readFileSync(configPath(), "utf8");
    return JSON.parse(raw) as AutomataConfig;
  } catch {
    return {};
  }
}

export function readConfig(): AutomataConfig {
  let config: AutomataConfig;
  try {
    const raw = readFileSync(configPath(), "utf8");
    config = JSON.parse(raw) as AutomataConfig;
  } catch {
    return {};
  }
  const dir = automataDir();
  if (config.claudeSystemPrompt) {
    config.claudeSystemPrompt = resolvePromptRef(config.claudeSystemPrompt, dir);
  }
  if (config.prompts?.sonar) {
    config.prompts.sonar = resolvePromptRef(config.prompts.sonar, dir);
  }
  if (config.prompts?.fixComments) {
    config.prompts.fixComments = resolvePromptRef(config.prompts.fixComments, dir);
  }
  if (config.prompts?.checkIssue) {
    config.prompts.checkIssue = resolvePromptRef(config.prompts.checkIssue, dir);
  }
  // `do-work` treats an unresolvable prompt as fatal rather than falling back to
  // the built-in default, so these throws are deliberately left to propagate.
  if (config.doWork?.prompts?.issueDiscuss) {
    config.doWork.prompts.issueDiscuss = resolvePromptRef(config.doWork.prompts.issueDiscuss, dir);
  }
  if (config.doWork?.prompts?.prWork) {
    config.doWork.prompts.prWork = resolvePromptRef(config.doWork.prompts.prWork, dir);
  }
  return config;
}

export function writeConfig(config: AutomataConfig): void {
  const dir = join(process.cwd(), CONFIG_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n", "utf8");
}
