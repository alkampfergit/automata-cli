import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type RemoteType = "gh" | "azdo";

export type IssueDiscoveryTechnique = "label" | "assignee" | "title-contains";

export interface AutomataConfig {
  remoteType?: RemoteType;
  issueDiscoveryTechnique?: IssueDiscoveryTechnique;
  issueDiscoveryValue?: string;
  claudeSystemPrompt?: string;
}

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
