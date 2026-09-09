import { Command } from "commander";
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

const configSetAllowedUsers = new Command("allowed-users")
  .description("Set the comma-separated list of users allowed to instruct the agent on an issue")
  .argument("<value>", "Comma-separated GitHub logins, e.g. alice,bob")
  .action((value: string) => {
    const users = value
      .split(",")
      .map((user) => user.trim())
      .filter((user) => user.length > 0);
    if (users.length === 0) {
      process.stderr.write("Error: allowed-users requires at least one login.\n");
      process.exit(1);
    }
    const current = readRawConfig();
    writeConfig({ ...current, allowedUsers: users });
    process.stdout.write(`Allowed users set to: ${users.join(", ")}\n`);
  });

const configSetAgentUser = new Command("agent-user")
  .description("Set the login the agent itself posts as")
  .argument("<value>", "GitHub login used by the agent")
  .action((value: string) => {
    const user = value.trim();
    if (user.length === 0) {
      process.stderr.write("Error: agent-user requires a non-empty login.\n");
      process.exit(1);
    }
    const current = readRawConfig();
    writeConfig({ ...current, agentUser: user });
    process.stdout.write(`Agent user set to: ${user}\n`);
  });

const configSet = new Command("set")
  .description("Set a configuration value")
  .addCommand(configSetType)
  .addCommand(configSetIssueDiscoveryTechnique)
  .addCommand(configSetIssueDiscoveryValue)
  .addCommand(configSetClaudeSystemPrompt)
  .addCommand(configSetAllowedUsers)
  .addCommand(configSetAgentUser);

export const configCommand = new Command("config")
  .description("Configure automata settings")
  .addCommand(configSet)
  .action(async () => {
    const [{ render }, React, { ConfigWizard }] = await Promise.all([
      import("ink"),
      import("react"),
      import("../config/ConfigWizard.js"),
    ]);
    const { waitUntilExit } = render(React.createElement(ConfigWizard));
    await waitUntilExit();
  });
