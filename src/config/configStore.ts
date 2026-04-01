import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

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

export const DEFAULT_FIX_COMMENTS_PROMPT =
  "You are an expert software engineer reviewing a pull request. " +
  "Below are the open review comments left by reviewers on this PR. " +
  "Please address each comment by making the appropriate code changes. " +
  "Focus on the reviewer's concerns and make minimal, targeted changes that resolve each comment without altering unrelated code.";

export const DEFAULT_SONAR_PROMPT =
  "You are an expert software engineer. You have been given the URL of a SonarCloud analysis for this pull request. " +
  "The project is public, so use the SonarCloud REST API directly (no authentication required) to fetch the list of issues rather than scraping the URL. " +
  "Fix all new issues reported. " +
  "Focus on code smells, bugs, and vulnerabilities flagged as new in this PR. " +
  "Make targeted, minimal changes that resolve each issue without altering unrelated code.";

const CONFIG_DIR = ".automata";
const CONFIG_FILE = "config.json";

function configPath(): string {
  return join(process.cwd(), CONFIG_DIR, CONFIG_FILE);
}

export function readConfig(): AutomataConfig {
  try {
    const raw = readFileSync(configPath(), "utf8");
    return JSON.parse(raw) as AutomataConfig;
  } catch {
    return {};
  }
}

export function writeConfig(config: AutomataConfig): void {
  const dir = join(process.cwd(), CONFIG_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n", "utf8");
}
