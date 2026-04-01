import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";

export type RemoteType = "gh" | "azdo";

export type IssueDiscoveryTechnique = "label" | "assignee" | "title-contains";

export interface AutomataPrompts {
  sonar?: string;
  fixComments?: string;
}

export interface AutomataConfig {
  remoteType?: RemoteType;
  issueDiscoveryTechnique?: IssueDiscoveryTechnique;
  issueDiscoveryValue?: string;
  claudeSystemPrompt?: string;
  prompts?: AutomataPrompts;
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
  const fullPath = resolve(dir, value);
  const safeBase = resolve(dir) + sep;
  if (!fullPath.startsWith(safeBase)) {
    throw new Error(`Prompt file "${value}" resolves outside .automata/`);
  }
  return readFileSync(fullPath, "utf8");
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
  return config;
}

export function writeConfig(config: AutomataConfig): void {
  const dir = join(process.cwd(), CONFIG_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n", "utf8");
}
