import { Command } from "commander";
import {
  readRawConfig,
  writeConfig,
  type RemoteType,
  type IssueDiscoveryTechnique,
  type Executor,
  type TurnKind,
  type AutomataDoWorkConfig,
  DEFAULT_DO_WORK,
} from "../config/configStore.js";

const VALID_TYPES: RemoteType[] = ["gh", "azdo"];
const VALID_TECHNIQUES: IssueDiscoveryTechnique[] = ["label", "assignee", "title-contains"];
const VALID_EXECUTORS: Executor[] = ["claude", "codex"];
const VALID_TURN_KINDS: TurnKind[] = ["issue-discuss", "pr-work", "pr-orphan"];

/** Merge one field into the `doWork` section, leaving the rest of the config alone. */
function writeDoWork(patch: Partial<AutomataDoWorkConfig>): void {
  const current = readRawConfig();
  writeConfig({ ...current, doWork: { ...current.doWork, ...patch } });
}

function parseNonNegativeInt(value: string, label: string): number {
  const trimmed = value.trim();
  const parsed = Number.parseInt(trimmed, 10);
  // `Number.isSafeInteger` matters: a large value can round-trip through
  // `String(parsed)` and match its input while still exceeding the safe range,
  // so `config set` would report success and persist something `do-work` then
  // rejects.
  if (Number.isNaN(parsed) || parsed < 0 || String(parsed) !== trimmed || !Number.isSafeInteger(parsed)) {
    process.stderr.write(`Error: ${label} must be a non-negative integer (got "${value}").\n`);
    process.exit(1);
  }
  return parsed;
}

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

const configSetDoWorkBaseBranch = new Command("do-work-base-branch")
  .description("Set the branch `do-work` returns to for discussion turns")
  .argument("<value>", `Branch name (default: ${DEFAULT_DO_WORK.baseBranch})`)
  .action((value: string) => {
    const branch = value.trim();
    if (branch.length === 0) {
      process.stderr.write("Error: do-work-base-branch requires a non-empty branch name.\n");
      process.exit(1);
    }
    writeDoWork({ baseBranch: branch });
    process.stdout.write(`do-work base branch set to: ${branch}\n`);
  });

const configSetDoWorkProtectedBranches = new Command("do-work-protected-branches")
  .description("Set the branches a `do-work` build turn must never check out and push to")
  .argument("<value>", `Comma-separated branch names (default: ${DEFAULT_DO_WORK.protectedBranches.join(",")})`)
  .action((value: string) => {
    const branches = value
      .split(",")
      .map((branch) => branch.trim())
      .filter((branch) => branch.length > 0);
    if (branches.length === 0) {
      process.stderr.write("Error: do-work-protected-branches requires at least one branch name.\n");
      process.exit(1);
    }
    writeDoWork({ protectedBranches: branches });
    process.stdout.write(`do-work protected branches set to: ${branches.join(", ")}\n`);
  });

const configSetDoWorkExecutor = new Command("do-work-executor")
  .description("Set the default executor `do-work` invokes")
  .argument("<value>", `Executor: ${VALID_EXECUTORS.join(", ")}`)
  .action((value: string) => {
    if (!VALID_EXECUTORS.includes(value as Executor)) {
      process.stderr.write(`Error: invalid executor "${value}". Must be one of: ${VALID_EXECUTORS.join(", ")}\n`);
      process.exit(1);
    }
    writeDoWork({ executor: value as Executor });
    process.stdout.write(`do-work executor set to: ${value}\n`);
  });

const configSetDoWorkModel = new Command("do-work-model")
  .description("Set the default model `do-work` passes to one executor")
  .argument("<executor>", `Executor: ${VALID_EXECUTORS.join(", ")}`)
  .argument("<value>", "Model identifier")
  .action((executor: string, value: string) => {
    if (!VALID_EXECUTORS.includes(executor as Executor)) {
      process.stderr.write(
        `Error: invalid executor "${executor}". Must be one of: ${VALID_EXECUTORS.join(", ")}\n`,
      );
      process.exit(1);
    }
    const model = value.trim();
    if (model.length === 0) {
      process.stderr.write("Error: do-work-model requires a non-empty model identifier.\n");
      process.exit(1);
    }
    const current = readRawConfig();
    writeDoWork({ models: { ...current.doWork?.models, [executor as Executor]: model } });
    process.stdout.write(`do-work ${executor} model set to: ${model}\n`);
  });

const configSetDoWorkEffort = new Command("do-work-effort")
  .description("Set the default reasoning effort `do-work` passes to one executor")
  .argument("<executor>", `Executor: ${VALID_EXECUTORS.join(", ")}`)
  .argument("<value>", "Effort level, forwarded to the executor unchanged")
  .action((executor: string, value: string) => {
    if (!VALID_EXECUTORS.includes(executor as Executor)) {
      process.stderr.write(
        `Error: invalid executor "${executor}". Must be one of: ${VALID_EXECUTORS.join(", ")}\n`,
      );
      process.exit(1);
    }
    // No allow-list of levels on purpose: the valid set is model-specific and
    // moves between executor releases, so an allow-list here would reject a
    // level the installed executor accepts. Note neither executor errors on an
    // unknown level — claude warns and falls back, codex forwards it — so this
    // trades a typo being caught for not blocking a newly-shipped level.
    const effort = value.trim();
    if (effort.length === 0) {
      process.stderr.write("Error: do-work-effort requires a non-empty effort level.\n");
      process.exit(1);
    }
    const current = readRawConfig();
    writeDoWork({ effort: { ...current.doWork?.effort, [executor as Executor]: effort } });
    process.stdout.write(`do-work ${executor} effort set to: ${effort}\n`);
  });

const configSetDoWorkMaxRuns = new Command("do-work-max-runs")
  .description("Set the maximum number of model runs `do-work` performs per tick (0 = unlimited)")
  .argument("<value>", "Non-negative integer")
  .action((value: string) => {
    const maxRunsPerTick = parseNonNegativeInt(value, "do-work-max-runs");
    writeDoWork({ maxRunsPerTick });
    process.stdout.write(
      `do-work max runs per tick set to: ${String(maxRunsPerTick)}${maxRunsPerTick === 0 ? " (unlimited)" : ""}\n`,
    );
  });

const configSetDoWorkLockStaleMinutes = new Command("do-work-lock-stale-minutes")
  .description("Set how long a run lock may be held before it is treated as stale")
  .argument("<value>", `Positive integer (default: ${String(DEFAULT_DO_WORK.lockStaleMinutes)})`)
  .action((value: string) => {
    const minutes = parseNonNegativeInt(value, "do-work-lock-stale-minutes");
    if (minutes === 0) {
      process.stderr.write("Error: do-work-lock-stale-minutes must be greater than zero.\n");
      process.exit(1);
    }
    writeDoWork({ lockStaleMinutes: minutes });
    process.stdout.write(`do-work lock staleness set to: ${String(minutes)} minutes\n`);
  });

const configSetDoWorkPrompt = new Command("do-work-prompt")
  .description("Set the turn instructions for a `do-work` turn kind (prompt text or a .md filename)")
  .argument("<turn-kind>", `Turn kind: ${VALID_TURN_KINDS.join(", ")}`)
  .argument("<value>", "Prompt text, or a plain .md filename inside .automata/")
  .action((turnKind: string, value: string) => {
    if (!VALID_TURN_KINDS.includes(turnKind as TurnKind)) {
      process.stderr.write(
        `Error: invalid turn kind "${turnKind}". Must be one of: ${VALID_TURN_KINDS.join(", ")}\n`,
      );
      process.exit(1);
    }
    const prompt = value.trim();
    if (prompt.length === 0) {
      process.stderr.write("Error: do-work-prompt requires a non-empty value.\n");
      process.exit(1);
    }
    const current = readRawConfig();
    const prompts = { ...current.doWork?.prompts };
    // An exhaustive switch rather than an if/else: a fourth turn kind added to
    // `TurnKind` must not fall through into whichever branch happened to be last.
    switch (turnKind as TurnKind) {
      case "issue-discuss":
        prompts.issueDiscuss = prompt;
        break;
      case "pr-work":
        prompts.prWork = prompt;
        break;
      case "pr-orphan":
        prompts.prOrphan = prompt;
        break;
    }
    writeDoWork({ prompts });
    process.stdout.write(`do-work ${turnKind} prompt set.\n`);
  });

const configSet = new Command("set")
  .description("Set a configuration value")
  .addCommand(configSetType)
  .addCommand(configSetIssueDiscoveryTechnique)
  .addCommand(configSetIssueDiscoveryValue)
  .addCommand(configSetClaudeSystemPrompt)
  .addCommand(configSetAllowedUsers)
  .addCommand(configSetAgentUser)
  .addCommand(configSetDoWorkBaseBranch)
  .addCommand(configSetDoWorkProtectedBranches)
  .addCommand(configSetDoWorkExecutor)
  .addCommand(configSetDoWorkModel)
  .addCommand(configSetDoWorkEffort)
  .addCommand(configSetDoWorkMaxRuns)
  .addCommand(configSetDoWorkLockStaleMinutes)
  .addCommand(configSetDoWorkPrompt);

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
