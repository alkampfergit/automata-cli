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
  | "do-work-max-runs"
  | "do-work-discuss-prompt"
  | "do-work-pr-prompt";

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
  const [doWorkExecutorIndex, setDoWorkExecutorIndex] = useState(
    initialExecutorIndex >= 0 ? initialExecutorIndex : 0,
  );
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

  useInput((input, key) => {
    if (screen === "main") {
      if (key.upArrow) {
        setMainMenuIndex((i) => (i > 0 ? i - 1 : MAIN_MENU_OPTIONS.length - 1));
      } else if (key.downArrow) {
        setMainMenuIndex((i) => (i < MAIN_MENU_OPTIONS.length - 1 ? i + 1 : 0));
      } else if (key.return) {
        const chosen = MAIN_MENU_OPTIONS[mainMenuIndex];
        if (chosen === "Remote / Mode") {
          setScreen("remote");
        } else if (chosen === "Implement-Next") {
          setScreen("technique");
        } else if (chosen === "Issue Watch") {
          setScreen("allowed-users");
        } else if (chosen === "Do Work") {
          setScreen("do-work-base-branch");
        } else {
          setScreen("prompts-menu");
        }
      } else if (key.escape || (key.ctrl && input === "c")) {
        exit();
      }
    } else if (screen === "remote") {
      if (key.upArrow) {
        setSelectedRemoteIndex((i) => (i > 0 ? i - 1 : REMOTE_OPTIONS.length - 1));
      } else if (key.downArrow) {
        setSelectedRemoteIndex((i) => (i < REMOTE_OPTIONS.length - 1 ? i + 1 : 0));
      } else if (key.return) {
        const chosen = REMOTE_OPTIONS[selectedRemoteIndex];
        setPendingRemote(chosen.value);
        if (chosen.value === "gh") {
          setScreen("technique");
        } else {
          writeConfig({ ...rawExisting, remoteType: chosen.value });
          exit();
        }
      } else if (key.escape) {
        setScreen("main");
      } else if (key.ctrl && input === "c") {
        exit();
      }
    } else if (screen === "technique") {
      if (key.upArrow) {
        setSelectedTechIndex((i) => (i > 0 ? i - 1 : TECHNIQUE_OPTIONS.length - 1));
      } else if (key.downArrow) {
        setSelectedTechIndex((i) => (i < TECHNIQUE_OPTIONS.length - 1 ? i + 1 : 0));
      } else if (key.return) {
        const chosen = TECHNIQUE_OPTIONS[selectedTechIndex];
        setPendingTechnique(chosen.value);
        setScreen("value");
      } else if (key.escape) {
        setScreen("main");
      } else if (key.ctrl && input === "c") {
        exit();
      }
    } else if (screen === "value") {
      if (key.return) {
        setScreen("system-prompt");
      } else if (key.backspace || key.delete) {
        setDiscoveryValue((v) => v.slice(0, -1));
      } else if (key.escape) {
        setScreen("main");
      } else if (key.ctrl && input === "c") {
        exit();
      } else if (input && !key.ctrl && !key.meta) {
        setDiscoveryValue((v) => v + input);
      }
    } else if (screen === "system-prompt") {
      if (key.return) {
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
      } else if (key.backspace || key.delete) {
        setSystemPrompt((v) => v.slice(0, -1));
      } else if (key.escape) {
        setScreen("main");
      } else if (key.ctrl && input === "c") {
        exit();
      } else if (input && !key.ctrl && !key.meta) {
        setSystemPrompt((v) => v + input);
      }
    } else if (screen === "prompts-menu") {
      if (key.upArrow) {
        setPromptsMenuIndex((i) => (i > 0 ? i - 1 : PROMPTS_MENU_OPTIONS.length - 1));
      } else if (key.downArrow) {
        setPromptsMenuIndex((i) => (i < PROMPTS_MENU_OPTIONS.length - 1 ? i + 1 : 0));
      } else if (key.return) {
        const chosen = PROMPTS_MENU_OPTIONS[promptsMenuIndex];
        if (chosen === "Do Work — Discuss") {
          setScreen("do-work-discuss-prompt");
          return;
        }
        if (chosen === "Do Work — PR") {
          setScreen("do-work-pr-prompt");
          return;
        }
        if (chosen === "Sonar") {
          setScreen("sonar-prompt");
        } else if (chosen === "Fix-Comments") {
          setScreen("fix-comments-prompt");
        } else {
          setScreen("check-issue-prompt");
        }
      } else if (key.escape) {
        setScreen("main");
      } else if (key.ctrl && input === "c") {
        exit();
      }
    } else if (screen === "sonar-prompt") {
      if (key.return) {
        let sonarValue: string | undefined;
        if (sonarPrompt) {
          writePromptFile("sonar-prompt.md", sonarPrompt);
          sonarValue = "sonar-prompt.md";
        }
        const current = readRawConfig();
        writeConfig({
          ...current,
          prompts: { ...current.prompts, sonar: sonarValue },
        });
        setScreen("prompts-menu");
      } else if (key.backspace || key.delete) {
        setSonarPrompt((v) => v.slice(0, -1));
      } else if (key.escape) {
        setScreen("prompts-menu");
      } else if (key.ctrl && input === "c") {
        exit();
      } else if (input && !key.ctrl && !key.meta) {
        setSonarPrompt((v) => v + input);
      }
    } else if (screen === "fix-comments-prompt") {
      if (key.return) {
        let fixCommentsValue: string | undefined;
        if (fixCommentsPrompt) {
          writePromptFile("fix-comments-prompt.md", fixCommentsPrompt);
          fixCommentsValue = "fix-comments-prompt.md";
        }
        const current = readRawConfig();
        writeConfig({
          ...current,
          prompts: { ...current.prompts, fixComments: fixCommentsValue },
        });
        setScreen("prompts-menu");
      } else if (key.backspace || key.delete) {
        setFixCommentsPrompt((v) => v.slice(0, -1));
      } else if (key.escape) {
        setScreen("prompts-menu");
      } else if (key.ctrl && input === "c") {
        exit();
      } else if (input && !key.ctrl && !key.meta) {
        setFixCommentsPrompt((v) => v + input);
      }
    } else if (screen === "check-issue-prompt") {
      if (key.return) {
        let checkIssueValue: string | undefined;
        if (checkIssuePrompt) {
          writePromptFile("check-issue-prompt.md", checkIssuePrompt);
          checkIssueValue = "check-issue-prompt.md";
        }
        const current = readRawConfig();
        writeConfig({
          ...current,
          prompts: { ...current.prompts, checkIssue: checkIssueValue },
        });
        setScreen("prompts-menu");
      } else if (key.backspace || key.delete) {
        setCheckIssuePrompt((v) => v.slice(0, -1));
      } else if (key.escape) {
        setScreen("prompts-menu");
      } else if (key.ctrl && input === "c") {
        exit();
      } else if (input && !key.ctrl && !key.meta) {
        setCheckIssuePrompt((v) => v + input);
      }
    } else if (screen === "allowed-users") {
      if (key.return) {
        setScreen("agent-user");
      } else if (key.backspace || key.delete) {
        setAllowedUsers((v) => v.slice(0, -1));
      } else if (key.escape) {
        setScreen("main");
      } else if (key.ctrl && input === "c") {
        exit();
      } else if (input && !key.ctrl && !key.meta) {
        setAllowedUsers((v) => v + input);
      }
    } else if (screen === "agent-user") {
      if (key.return) {
        const parsedUsers = parseAllowedUsers(allowedUsers);
        const current = readRawConfig();
        writeConfig({
          ...current,
          allowedUsers: parsedUsers.length > 0 ? parsedUsers : undefined,
          agentUser: agentUser.trim() || undefined,
        });
        exit();
      } else if (key.backspace || key.delete) {
        setAgentUser((v) => v.slice(0, -1));
      } else if (key.escape) {
        setScreen("allowed-users");
      } else if (key.ctrl && input === "c") {
        exit();
      } else if (input && !key.ctrl && !key.meta) {
        setAgentUser((v) => v + input);
      }
    } else if (screen === "do-work-base-branch") {
      if (key.return) {
        setScreen("do-work-executor");
      } else if (key.backspace || key.delete) {
        setDoWorkBaseBranch((v) => v.slice(0, -1));
      } else if (key.escape) {
        setScreen("main");
      } else if (key.ctrl && input === "c") {
        exit();
      } else if (input && !key.ctrl && !key.meta) {
        setDoWorkBaseBranch((v) => v + input);
      }
    } else if (screen === "do-work-executor") {
      if (key.upArrow) {
        setDoWorkExecutorIndex((i) => (i > 0 ? i - 1 : EXECUTOR_OPTIONS.length - 1));
      } else if (key.downArrow) {
        setDoWorkExecutorIndex((i) => (i < EXECUTOR_OPTIONS.length - 1 ? i + 1 : 0));
      } else if (key.return) {
        setScreen("do-work-max-runs");
      } else if (key.escape) {
        setScreen("do-work-base-branch");
      } else if (key.ctrl && input === "c") {
        exit();
      }
    } else if (screen === "do-work-max-runs") {
      if (key.return) {
        const parsedMaxRuns = Number.parseInt(doWorkMaxRuns, 10);
        const current = readRawConfig();
        writeConfig({
          ...current,
          doWork: {
            ...current.doWork,
            baseBranch: doWorkBaseBranch.trim() || undefined,
            executor: EXECUTOR_OPTIONS[doWorkExecutorIndex].value,
            maxRunsPerTick: Number.isNaN(parsedMaxRuns) || parsedMaxRuns < 0 ? undefined : parsedMaxRuns,
          },
        });
        exit();
      } else if (key.backspace || key.delete) {
        setDoWorkMaxRuns((v) => v.slice(0, -1));
      } else if (key.escape) {
        setScreen("do-work-executor");
      } else if (key.ctrl && input === "c") {
        exit();
      } else if (input && !key.ctrl && !key.meta) {
        setDoWorkMaxRuns((v) => v + input);
      }
    } else if (screen === "do-work-discuss-prompt") {
      if (key.return) {
        let discussValue: string | undefined;
        if (doWorkDiscussPrompt) {
          writePromptFile("do-work-issue-discuss.md", doWorkDiscussPrompt);
          discussValue = "do-work-issue-discuss.md";
        }
        const current = readRawConfig();
        writeConfig({
          ...current,
          doWork: {
            ...current.doWork,
            prompts: { ...current.doWork?.prompts, issueDiscuss: discussValue },
          },
        });
        setScreen("prompts-menu");
      } else if (key.backspace || key.delete) {
        setDoWorkDiscussPrompt((v) => v.slice(0, -1));
      } else if (key.escape) {
        setScreen("prompts-menu");
      } else if (key.ctrl && input === "c") {
        exit();
      } else if (input && !key.ctrl && !key.meta) {
        setDoWorkDiscussPrompt((v) => v + input);
      }
    } else if (screen === "do-work-pr-prompt") {
      if (key.return) {
        let prValue: string | undefined;
        if (doWorkPrPrompt) {
          writePromptFile("do-work-pr-work.md", doWorkPrPrompt);
          prValue = "do-work-pr-work.md";
        }
        const current = readRawConfig();
        writeConfig({
          ...current,
          doWork: {
            ...current.doWork,
            prompts: { ...current.doWork?.prompts, prWork: prValue },
          },
        });
        setScreen("prompts-menu");
      } else if (key.backspace || key.delete) {
        setDoWorkPrPrompt((v) => v.slice(0, -1));
      } else if (key.escape) {
        setScreen("prompts-menu");
      } else if (key.ctrl && input === "c") {
        exit();
      } else if (input && !key.ctrl && !key.meta) {
        setDoWorkPrPrompt((v) => v + input);
      }
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
