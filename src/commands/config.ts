import { Command } from "commander";
import { render } from "ink";
import React from "react";
import { ConfigWizard } from "../config/ConfigWizard.js";
import { readRawConfig, writeConfig, type RemoteType, type IssueDiscoveryTechnique } from "../config/configStore.js";

const VALID_TYPES: RemoteType[] = ["gh", "azdo"];
const VALID_TECHNIQUES: IssueDiscoveryTechnique[] = ["label", "assignee", "title-contains"];

const configSetType = new Command("type")
  .description("Set the remote environment type")
  .argument("<value>", "Remote type: gh (GitHub) or azdo (Azure DevOps)")
  .action((value: string) => {
    if (!VALID_TYPES.includes(value as RemoteType)) {
      process.stderr.write(`Error: invalid type "${value}". Must be one of: ${VALID_TYPES.join(", ")}\n`);
      process.exit(1);
    }
    const current = readRawConfig();
    writeConfig({ ...current, remoteType: value as RemoteType });
    process.stdout.write(`Remote type set to: ${value}\n`);
  });

const configSetIssueDiscoveryTechnique = new Command("issue-discovery-technique")
  .description("Set the issue discovery technique (GitHub mode only)")
  .argument("<value>", `Technique: ${VALID_TECHNIQUES.join(", ")}`)
  .action((value: string) => {
    if (!VALID_TECHNIQUES.includes(value as IssueDiscoveryTechnique)) {
      process.stderr.write(`Error: invalid technique "${value}". Must be one of: ${VALID_TECHNIQUES.join(", ")}\n`);
      process.exit(1);
    }
    const current = readRawConfig();
    writeConfig({ ...current, issueDiscoveryTechnique: value as IssueDiscoveryTechnique });
    process.stdout.write(`Issue discovery technique set to: ${value}\n`);
  });

const configSetIssueDiscoveryValue = new Command("issue-discovery-value")
  .description("Set the value for the issue discovery technique (label name, username, or search string)")
  .argument("<value>", "The filter value")
  .action((value: string) => {
    const current = readRawConfig();
    writeConfig({ ...current, issueDiscoveryValue: value });
    process.stdout.write(`Issue discovery value set to: ${value}\n`);
  });

const configSetClaudeSystemPrompt = new Command("claude-system-prompt")
  .description("Set the system prompt used when invoking Claude Code")
  .argument("<value>", "System prompt text")
  .action((value: string) => {
    const current = readRawConfig();
    writeConfig({ ...current, claudeSystemPrompt: value });
    process.stdout.write(`Claude system prompt set.\n`);
  });

const configSet = new Command("set")
  .description("Set a configuration value")
  .addCommand(configSetType)
  .addCommand(configSetIssueDiscoveryTechnique)
  .addCommand(configSetIssueDiscoveryValue)
  .addCommand(configSetClaudeSystemPrompt);

export const configCommand = new Command("config")
  .description("Configure automata settings")
  .addCommand(configSet)
  .action(async () => {
    const { waitUntilExit } = render(React.createElement(ConfigWizard));
    await waitUntilExit();
  });
