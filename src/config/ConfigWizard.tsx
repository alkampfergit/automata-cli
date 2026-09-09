import React, { useState } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  readConfig,
  readRawConfig,
  writeConfig,
  DEFAULT_SONAR_PROMPT,
  DEFAULT_FIX_COMMENTS_PROMPT,
  DEFAULT_CHECK_ISSUE_PROMPT,
  DEFAULT_DO_WORK,
  DEFAULT_DO_WORK_ISSUE_DISCUSS_PROMPT,
  DEFAULT_DO_WORK_PR_WORK_PROMPT,
  type RemoteType,
  type IssueDiscoveryTechnique,
  type Executor,
  type AutomataConfig,
} from "./configStore.js";

function writePromptFile(filename: string, content: string): void {
  const dir = join(process.cwd(), ".automata");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), content, "utf8");
}

const REMOTE_OPTIONS: { label: string; value: RemoteType }[] = [
  { label: "GitHub", value: "gh" },
  { label: "Azure DevOps", value: "azdo" },
];

const TECHNIQUE_OPTIONS: { label: string; value: IssueDiscoveryTechnique }[] = [
  { label: "By Label", value: "label" },
  { label: "By Assignee", value: "assignee" },
  { label: "By Title Contains", value: "title-contains" },
];

const EXECUTOR_OPTIONS: { label: string; value: Executor }[] = [
  { label: "Claude Code", value: "claude" },
  { label: "Codex", value: "codex" },
];

// New entries are appended so existing menu positions — and the navigation tests
// that depend on them — stay valid.
const MAIN_MENU_OPTIONS = ["Remote / Mode", "Implement-Next", "Prompts", "Issue Watch", "Do Work"] as const;

const PROMPTS_MENU_OPTIONS = [
  "Sonar",
  "Fix-Comments",
  "Check-Issue",
  "Do Work — Discuss",
  "Do Work — PR",
] as const;

function parseAllowedUsers(value: string): string[] {
  return value
    .split(",")
    .map((user) => user.trim())
    .filter((user) => user.length > 0);
}

type Screen =
  | "main"
  | "remote"
  | "technique"
  | "value"
  | "system-prompt"
  | "prompts-menu"
  | "sonar-prompt"
  | "fix-comments-prompt"
  | "check-issue-prompt"
  | "allowed-users"
  | "agent-user"
  | "do-work-base-branch"
  | "do-work-executor"
  | "do-work-claude-model"
  | "do-work-codex-model"
  | "do-work-max-runs"
  | "do-work-discuss-prompt"
  | "do-work-pr-prompt";

/** The subset of ink's key object this wizard reacts to. */
interface InkKey {
  upArrow: boolean;
  downArrow: boolean;
  return: boolean;
  escape: boolean;
  backspace: boolean;
  delete: boolean;
  ctrl: boolean;
  meta: boolean;
}

interface TextScreen {
  setValue: (update: (value: string) => string) => void;
  onSubmit: () => void;
  onBack: () => void;
}

/** Shared behaviour of every text-entry screen. */
function handleTextEntry(input: string, key: InkKey, screen: TextScreen, cancel: () => void): void {
  if (key.return) {
    screen.onSubmit();
  } else if (key.backspace || key.delete) {
    screen.setValue((value) => value.slice(0, -1));
  } else if (key.escape) {
    screen.onBack();
  } else if (key.ctrl && input === "c") {
    cancel();
  } else if (input && !key.ctrl && !key.meta) {
    screen.setValue((value) => value + input);
  }
}

/** Shared behaviour of every arrow-navigated list screen. */
function handleMenu(
  input: string,
  key: InkKey,
  index: number,
  length: number,
  setIndex: (update: (index: number) => number) => void,
  cancel: () => void,
  onSelect: () => void,
  onBack?: () => void,
): void {
  if (key.upArrow) {
    setIndex((i) => (i > 0 ? i - 1 : length - 1));
  } else if (key.downArrow) {
    setIndex((i) => (i < length - 1 ? i + 1 : 0));
  } else if (key.return) {
    onSelect();
  } else if (key.escape) {
    if (onBack) onBack();
    else cancel();
  } else if (key.ctrl && input === "c") {
    cancel();
  }
}

/** Write a prompt file (when non-empty) and store its filename in the config. */
function savePrompt(
  filename: string,
  content: string,
  merge: (value: string | undefined, current: AutomataConfig) => AutomataConfig,
): void {
  let value: string | undefined;
  if (content) {
    writePromptFile(filename, content);
    value = filename;
  }
  writeConfig(merge(value, readRawConfig()));
}

const PROMPT_SCREEN_BY_OPTION: Record<(typeof PROMPTS_MENU_OPTIONS)[number], Screen> = {
  Sonar: "sonar-prompt",
  "Fix-Comments": "fix-comments-prompt",
  "Check-Issue": "check-issue-prompt",
  "Do Work — Discuss": "do-work-discuss-prompt",
  "Do Work — PR": "do-work-pr-prompt",
};

export function ConfigWizard() {
  const existing = readConfig();
  const rawExisting = readRawConfig();
  const initialRemoteIndex = REMOTE_OPTIONS.findIndex((o) => o.value === existing.remoteType);
  const initialTechIndex = TECHNIQUE_OPTIONS.findIndex((o) => o.value === existing.issueDiscoveryTechnique);

  const [screen, setScreen] = useState<Screen>("main");
  const [mainMenuIndex, setMainMenuIndex] = useState(0);
  const [selectedRemoteIndex, setSelectedRemoteIndex] = useState(initialRemoteIndex >= 0 ? initialRemoteIndex : 0);
  const [selectedTechIndex, setSelectedTechIndex] = useState(initialTechIndex >= 0 ? initialTechIndex : 0);
  const [discoveryValue, setDiscoveryValue] = useState(existing.issueDiscoveryValue ?? "");
  const [systemPrompt, setSystemPrompt] = useState(existing.claudeSystemPrompt ?? "");
  const [promptsMenuIndex, setPromptsMenuIndex] = useState(0);
  const [sonarPrompt, setSonarPrompt] = useState(existing.prompts?.sonar ?? DEFAULT_SONAR_PROMPT);
  const [fixCommentsPrompt, setFixCommentsPrompt] = useState(
    existing.prompts?.fixComments ?? DEFAULT_FIX_COMMENTS_PROMPT,
  );
  const [checkIssuePrompt, setCheckIssuePrompt] = useState(existing.prompts?.checkIssue ?? DEFAULT_CHECK_ISSUE_PROMPT);
  const [allowedUsers, setAllowedUsers] = useState((existing.allowedUsers ?? []).join(", "));
  const [agentUser, setAgentUser] = useState(existing.agentUser ?? "");
  const [doWorkBaseBranch, setDoWorkBaseBranch] = useState(
    existing.doWork?.baseBranch ?? DEFAULT_DO_WORK.baseBranch,
  );
  const initialExecutorIndex = EXECUTOR_OPTIONS.findIndex((o) => o.value === existing.doWork?.executor);
  const [doWorkExecutorIndex, setDoWorkExecutorIndex] = useState(Math.max(initialExecutorIndex, 0));
  const [doWorkClaudeModel, setDoWorkClaudeModel] = useState(existing.doWork?.models?.claude ?? "");
  const [doWorkCodexModel, setDoWorkCodexModel] = useState(existing.doWork?.models?.codex ?? "");
  const [doWorkMaxRuns, setDoWorkMaxRuns] = useState(
    String(existing.doWork?.maxRunsPerTick ?? DEFAULT_DO_WORK.maxRunsPerTick),
  );
  const [doWorkDiscussPrompt, setDoWorkDiscussPrompt] = useState(
    existing.doWork?.prompts?.issueDiscuss ?? DEFAULT_DO_WORK_ISSUE_DISCUSS_PROMPT,
  );
  const [doWorkPrPrompt, setDoWorkPrPrompt] = useState(
    existing.doWork?.prompts?.prWork ?? DEFAULT_DO_WORK_PR_WORK_PROMPT,
  );
  const [pendingRemote, setPendingRemote] = useState<RemoteType>(existing.remoteType ?? "gh");
  const [pendingTechnique, setPendingTechnique] = useState<IssueDiscoveryTechnique>(
    existing.issueDiscoveryTechnique ?? "label",
  );
  const { exit } = useApp();

  /**
   * Every text-entry screen behaves identically — type, Enter to advance, Esc to
   * go back, Ctrl+C to cancel — so they are described as data rather than as a
   * dozen copies of the same branch chain. Only the list screens, which need
   * arrow handling, stay in the handler below.
   */
  const textScreens: Partial<Record<Screen, TextScreen>> = {
    value: {
      setValue: setDiscoveryValue,
      onSubmit: () => setScreen("system-prompt"),
      onBack: () => setScreen("main"),
    },
    "system-prompt": {
      setValue: setSystemPrompt,
      onSubmit: () => {
        let claudeSystemPromptValue: string | undefined;
        if (systemPrompt) {
          writePromptFile("claude-system-prompt.md", systemPrompt);
          claudeSystemPromptValue = "claude-system-prompt.md";
        }
        writeConfig({
          ...rawExisting,
          remoteType: pendingRemote,
          issueDiscoveryTechnique: pendingTechnique,
          issueDiscoveryValue: discoveryValue || undefined,
          claudeSystemPrompt: claudeSystemPromptValue,
        });
        exit();
      },
      onBack: () => setScreen("main"),
    },
    "sonar-prompt": {
      setValue: setSonarPrompt,
      onSubmit: () => {
        savePrompt("sonar-prompt.md", sonarPrompt, (value, current) => ({
          ...current,
          prompts: { ...current.prompts, sonar: value },
        }));
        setScreen("prompts-menu");
      },
      onBack: () => setScreen("prompts-menu"),
    },
    "fix-comments-prompt": {
      setValue: setFixCommentsPrompt,
      onSubmit: () => {
        savePrompt("fix-comments-prompt.md", fixCommentsPrompt, (value, current) => ({
          ...current,
          prompts: { ...current.prompts, fixComments: value },
        }));
        setScreen("prompts-menu");
      },
      onBack: () => setScreen("prompts-menu"),
    },
    "check-issue-prompt": {
      setValue: setCheckIssuePrompt,
      onSubmit: () => {
        savePrompt("check-issue-prompt.md", checkIssuePrompt, (value, current) => ({
          ...current,
          prompts: { ...current.prompts, checkIssue: value },
        }));
        setScreen("prompts-menu");
      },
      onBack: () => setScreen("prompts-menu"),
    },
    "allowed-users": {
      setValue: setAllowedUsers,
      onSubmit: () => setScreen("agent-user"),
      onBack: () => setScreen("main"),
    },
    "agent-user": {
      setValue: setAgentUser,
      onSubmit: () => {
        const parsedUsers = parseAllowedUsers(allowedUsers);
        const current = readRawConfig();
        writeConfig({
          ...current,
          allowedUsers: parsedUsers.length > 0 ? parsedUsers : undefined,
          agentUser: agentUser.trim() || undefined,
        });
        exit();
      },
      onBack: () => setScreen("allowed-users"),
    },
    "do-work-base-branch": {
      setValue: setDoWorkBaseBranch,
      onSubmit: () => setScreen("do-work-executor"),
      onBack: () => setScreen("main"),
    },
    "do-work-claude-model": {
      setValue: setDoWorkClaudeModel,
      onSubmit: () => setScreen("do-work-codex-model"),
      onBack: () => setScreen("do-work-executor"),
    },
    "do-work-codex-model": {
      setValue: setDoWorkCodexModel,
      onSubmit: () => setScreen("do-work-max-runs"),
      onBack: () => setScreen("do-work-claude-model"),
    },
    "do-work-max-runs": {
      setValue: setDoWorkMaxRuns,
      onSubmit: () => {
        const parsedMaxRuns = Number.parseInt(doWorkMaxRuns, 10);
        const current = readRawConfig();
        writeConfig({
          ...current,
          doWork: {
            ...current.doWork,
            baseBranch: doWorkBaseBranch.trim() || undefined,
            executor: EXECUTOR_OPTIONS[doWorkExecutorIndex].value,
            models: {
              claude: doWorkClaudeModel.trim() || undefined,
              codex: doWorkCodexModel.trim() || undefined,
            },
            maxRunsPerTick: Number.isNaN(parsedMaxRuns) || parsedMaxRuns < 0 ? undefined : parsedMaxRuns,
          },
        });
        exit();
      },
      onBack: () => setScreen("do-work-codex-model"),
    },
    "do-work-discuss-prompt": {
      setValue: setDoWorkDiscussPrompt,
      onSubmit: () => {
        savePrompt("do-work-issue-discuss.md", doWorkDiscussPrompt, (value, current) => ({
          ...current,
          doWork: { ...current.doWork, prompts: { ...current.doWork?.prompts, issueDiscuss: value } },
        }));
        setScreen("prompts-menu");
      },
      onBack: () => setScreen("prompts-menu"),
    },
    "do-work-pr-prompt": {
      setValue: setDoWorkPrPrompt,
      onSubmit: () => {
        savePrompt("do-work-pr-work.md", doWorkPrPrompt, (value, current) => ({
          ...current,
          doWork: { ...current.doWork, prompts: { ...current.doWork?.prompts, prWork: value } },
        }));
        setScreen("prompts-menu");
      },
      onBack: () => setScreen("prompts-menu"),
    },
  };

  useInput((input, key) => {
    const textScreen = textScreens[screen];
    if (textScreen) {
      handleTextEntry(input, key, textScreen, exit);
      return;
    }

    if (screen === "main") {
      handleMenu(input, key, mainMenuIndex, MAIN_MENU_OPTIONS.length, setMainMenuIndex, exit, () => {
        const chosen = MAIN_MENU_OPTIONS[mainMenuIndex];
        if (chosen === "Remote / Mode") setScreen("remote");
        else if (chosen === "Implement-Next") setScreen("technique");
        else if (chosen === "Issue Watch") setScreen("allowed-users");
        else if (chosen === "Do Work") setScreen("do-work-base-branch");
        else setScreen("prompts-menu");
      });
    } else if (screen === "remote") {
      handleMenu(
        input,
        key,
        selectedRemoteIndex,
        REMOTE_OPTIONS.length,
        setSelectedRemoteIndex,
        exit,
        () => {
          setPendingRemote(REMOTE_OPTIONS[selectedRemoteIndex].value);
          setScreen("technique");
        },
        () => setScreen("main"),
      );
    } else if (screen === "technique") {
      handleMenu(
        input,
        key,
        selectedTechIndex,
        TECHNIQUE_OPTIONS.length,
        setSelectedTechIndex,
        exit,
        () => {
          setPendingTechnique(TECHNIQUE_OPTIONS[selectedTechIndex].value);
          setScreen("value");
        },
        () => setScreen("main"),
      );
    } else if (screen === "prompts-menu") {
      handleMenu(input, key, promptsMenuIndex, PROMPTS_MENU_OPTIONS.length, setPromptsMenuIndex, exit, () => {
        setScreen(PROMPT_SCREEN_BY_OPTION[PROMPTS_MENU_OPTIONS[promptsMenuIndex]]);
      }, () => setScreen("main"));
    } else if (screen === "do-work-executor") {
      handleMenu(
        input,
        key,
        doWorkExecutorIndex,
        EXECUTOR_OPTIONS.length,
        setDoWorkExecutorIndex,
        exit,
        () => setScreen("do-work-claude-model"),
        () => setScreen("do-work-base-branch"),
      );
    }
  });

  if (screen === "main") {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold>Configure Automata</Text>
        <Text> </Text>
        {MAIN_MENU_OPTIONS.map((option, index) => (
          <Box key={option}>
            <Text color={index === mainMenuIndex ? "cyan" : undefined}>
              {index === mainMenuIndex ? "❯ " : "  "}
              {option}
            </Text>
          </Box>
        ))}
        <Text> </Text>
        <Text dimColor>↑/↓ to move · Enter to select · Ctrl+C to cancel</Text>
      </Box>
    );
  }

  if (screen === "remote") {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold>Remote / Mode</Text>
        <Text> </Text>
        <Text>Remote environment type:</Text>
        {REMOTE_OPTIONS.map((option, index) => (
          <Box key={option.value}>
            <Text color={index === selectedRemoteIndex ? "cyan" : undefined}>
              {index === selectedRemoteIndex ? "❯ " : "  "}
              {option.label}
            </Text>
          </Box>
        ))}
        <Text> </Text>
        <Text dimColor>↑/↓ to move · Enter to confirm · Esc to go back · Ctrl+C to cancel</Text>
      </Box>
    );
  }

  if (screen === "technique") {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold>Implement-Next — Issue Discovery Technique</Text>
        <Text> </Text>
        <Text>How to find the next issue to work on:</Text>
        {TECHNIQUE_OPTIONS.map((option, index) => (
          <Box key={option.value}>
            <Text color={index === selectedTechIndex ? "cyan" : undefined}>
              {index === selectedTechIndex ? "❯ " : "  "}
              {option.label}
            </Text>
          </Box>
        ))}
        <Text> </Text>
        <Text dimColor>↑/↓ to move · Enter to confirm · Esc to go back · Ctrl+C to cancel</Text>
      </Box>
    );
  }

  if (screen === "value") {
    const techLabel = TECHNIQUE_OPTIONS.find((t) => t.value === pendingTechnique)?.label ?? pendingTechnique;
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold>Implement-Next — Issue Discovery Value</Text>
        <Text> </Text>
        <Text>
          {techLabel} value:{" "}
          <Text color="cyan">
            {discoveryValue}
            <Text>_</Text>
          </Text>
        </Text>
        <Text> </Text>
        <Text dimColor>Type value · Enter to continue · Esc to go back · Ctrl+C to cancel</Text>
      </Box>
    );
  }

  if (screen === "system-prompt") {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold>Implement-Next — Claude System Prompt</Text>
        <Text> </Text>
        <Text>
          System prompt (optional):{" "}
          <Text color="cyan">
            {systemPrompt}
            <Text>_</Text>
          </Text>
        </Text>
        <Text> </Text>
        <Text dimColor>Type prompt · Enter to save and exit · Esc to go back · Ctrl+C to cancel</Text>
      </Box>
    );
  }

  if (screen === "prompts-menu") {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold>Prompts</Text>
        <Text> </Text>
        {PROMPTS_MENU_OPTIONS.map((option, index) => (
          <Box key={option}>
            <Text color={index === promptsMenuIndex ? "cyan" : undefined}>
              {index === promptsMenuIndex ? "❯ " : "  "}
              {option}
            </Text>
          </Box>
        ))}
        <Text> </Text>
        <Text dimColor>↑/↓ to move · Enter to edit · Esc to go back · Ctrl+C to cancel</Text>
      </Box>
    );
  }

  if (screen === "sonar-prompt") {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold>Prompts — Sonar</Text>
        <Text> </Text>
        <Text>
          Sonar prompt:{" "}
          <Text color="cyan">
            {sonarPrompt}
            <Text>_</Text>
          </Text>
        </Text>
        <Text> </Text>
        <Text dimColor>Type prompt · Enter to save · Esc to go back · Ctrl+C to cancel</Text>
      </Box>
    );
  }

  if (screen === "check-issue-prompt") {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold>Prompts — Check-Issue</Text>
        <Text> </Text>
        <Text>
          Check-Issue prompt:{" "}
          <Text color="cyan">
            {checkIssuePrompt}
            <Text>_</Text>
          </Text>
        </Text>
        <Text> </Text>
        <Text dimColor>Type prompt · Enter to save · Esc to go back · Ctrl+C to cancel</Text>
      </Box>
    );
  }

  if (screen === "allowed-users") {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold>Issue Watch — Allowed Users</Text>
        <Text> </Text>
        <Text>
          Logins allowed to instruct the agent (comma separated):{" "}
          <Text color="cyan">
            {allowedUsers}
            <Text>_</Text>
          </Text>
        </Text>
        <Text> </Text>
        <Text dimColor>Type logins · Enter to continue · Esc to go back · Ctrl+C to cancel</Text>
      </Box>
    );
  }

  if (screen === "do-work-base-branch") {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold>Do Work — Base Branch</Text>
        <Text> </Text>
        <Text>
          Branch discussion turns return to:{" "}
          <Text color="cyan">
            {doWorkBaseBranch}
            <Text>_</Text>
          </Text>
        </Text>
        <Text> </Text>
        <Text dimColor>Type branch · Enter to continue · Esc to go back · Ctrl+C to cancel</Text>
      </Box>
    );
  }

  if (screen === "do-work-executor") {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold>Do Work — Executor</Text>
        <Text> </Text>
        {EXECUTOR_OPTIONS.map((option, index) => (
          <Box key={option.value}>
            <Text color={index === doWorkExecutorIndex ? "cyan" : undefined}>
              {index === doWorkExecutorIndex ? "❯ " : "  "}
              {option.label}
            </Text>
          </Box>
        ))}
        <Text> </Text>
        <Text dimColor>↑/↓ to move · Enter to continue · Esc to go back · Ctrl+C to cancel</Text>
      </Box>
    );
  }

  if (screen === "do-work-claude-model") {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold>Do Work — Claude Model</Text>
        <Text> </Text>
        <Text>
          Default model when the executor is Claude (blank = the executor&apos;s own default):{" "}
          <Text color="cyan">
            {doWorkClaudeModel}
            <Text>_</Text>
          </Text>
        </Text>
        <Text> </Text>
        <Text dimColor>Type model · Enter to continue · Esc to go back · Ctrl+C to cancel</Text>
      </Box>
    );
  }

  if (screen === "do-work-codex-model") {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold>Do Work — Codex Model</Text>
        <Text> </Text>
        <Text>
          Default model when the executor is Codex (blank = the executor&apos;s own default):{" "}
          <Text color="cyan">
            {doWorkCodexModel}
            <Text>_</Text>
          </Text>
        </Text>
        <Text> </Text>
        <Text dimColor>Type model · Enter to continue · Esc to go back · Ctrl+C to cancel</Text>
      </Box>
    );
  }

  if (screen === "do-work-max-runs") {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold>Do Work — Max Runs Per Tick</Text>
        <Text> </Text>
        <Text>
          Model runs allowed per tick (0 = unlimited):{" "}
          <Text color="cyan">
            {doWorkMaxRuns}
            <Text>_</Text>
          </Text>
        </Text>
        <Text> </Text>
        <Text dimColor>Type a number · Enter to save · Esc to go back · Ctrl+C to cancel</Text>
      </Box>
    );
  }

  if (screen === "do-work-discuss-prompt") {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold>Prompts — Do Work — Discuss</Text>
        <Text> </Text>
        <Text>
          Discussion turn instructions:{" "}
          <Text color="cyan">
            {doWorkDiscussPrompt}
            <Text>_</Text>
          </Text>
        </Text>
        <Text> </Text>
        <Text dimColor>Type prompt · Enter to save · Esc to go back · Ctrl+C to cancel</Text>
      </Box>
    );
  }

  if (screen === "do-work-pr-prompt") {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold>Prompts — Do Work — PR</Text>
        <Text> </Text>
        <Text>
          Pull request turn instructions:{" "}
          <Text color="cyan">
            {doWorkPrPrompt}
            <Text>_</Text>
          </Text>
        </Text>
        <Text> </Text>
        <Text dimColor>Type prompt · Enter to save · Esc to go back · Ctrl+C to cancel</Text>
      </Box>
    );
  }

  if (screen === "agent-user") {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold>Issue Watch — Agent User</Text>
        <Text> </Text>
        <Text>
          Login the agent posts as:{" "}
          <Text color="cyan">
            {agentUser}
            <Text>_</Text>
          </Text>
        </Text>
        <Text> </Text>
        <Text dimColor>Type login · Enter to save and exit · Esc to go back · Ctrl+C to cancel</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold>Prompts — Fix-Comments</Text>
      <Text> </Text>
      <Text>
        Fix-Comments prompt:{" "}
        <Text color="cyan">
          {fixCommentsPrompt}
          <Text>_</Text>
        </Text>
      </Text>
      <Text> </Text>
      <Text dimColor>Type prompt · Enter to save · Esc to go back · Ctrl+C to cancel</Text>
    </Box>
  );
}
