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
  | "do-work-protected-branches"
  | "do-work-executor"
  | "do-work-claude-model"
  | "do-work-codex-model"
  | "do-work-max-runs"
  | "do-work-lock-stale"
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

interface MenuScreen {
  index: number;
  length: number;
  setIndex: (update: (index: number) => number) => void;
  onSelect: () => void;
  /** Omitted means Escape cancels the wizard rather than going back. */
  onBack?: () => void;
}

/** Shared behaviour of every arrow-navigated list screen. */
function handleMenu(input: string, key: InkKey, menu: MenuScreen, cancel: () => void): void {
  if (key.upArrow) {
    menu.setIndex((i) => (i > 0 ? i - 1 : menu.length - 1));
  } else if (key.downArrow) {
    menu.setIndex((i) => (i < menu.length - 1 ? i + 1 : 0));
  } else if (key.return) {
    menu.onSelect();
  } else if (key.escape) {
    if (menu.onBack) menu.onBack();
    else cancel();
  } else if (key.ctrl && input === "c") {
    cancel();
  }
}

interface TextView {
  title: string;
  label: string;
  value: string;
  hint: string;
  error?: string;
}

interface MenuView {
  title: string;
  options: readonly string[];
  index: number;
  hint: string;
}

function TextEntryScreen({ title, label, value, hint, error }: Readonly<TextView>) {
  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold>{title}</Text>
      <Text> </Text>
      <Text>
        {label}{" "}
        <Text color="cyan">
          {value}
          <Text>_</Text>
        </Text>
      </Text>
      {error ? <Text color="red">{error}</Text> : <Text> </Text>}
      <Text dimColor>{hint}</Text>
    </Box>
  );
}

function MenuEntryScreen({ title, options, index, hint }: Readonly<MenuView>) {
  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold>{title}</Text>
      <Text> </Text>
      {options.map((option, optionIndex) => (
        <Box key={option}>
          <Text color={optionIndex === index ? "cyan" : undefined}>
            {optionIndex === index ? "❯ " : "  "}
            {option}
          </Text>
        </Box>
      ))}
      <Text> </Text>
      <Text dimColor>{hint}</Text>
    </Box>
  );
}

const BACK = "Esc to go back · Ctrl+C to cancel";

/** Parse the whole token, or null. `parseInt` would accept "2abc" and "2.5". */
function parseWholeInt(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
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
  const [selectedRemoteIndex, setSelectedRemoteIndex] = useState(Math.max(initialRemoteIndex, 0));
  const [selectedTechIndex, setSelectedTechIndex] = useState(Math.max(initialTechIndex, 0));
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
  const [doWorkProtectedBranches, setDoWorkProtectedBranches] = useState(
    (existing.doWork?.protectedBranches ?? DEFAULT_DO_WORK.protectedBranches).join(", "),
  );
  const [doWorkClaudeModel, setDoWorkClaudeModel] = useState(existing.doWork?.models?.claude ?? "");
  const [doWorkCodexModel, setDoWorkCodexModel] = useState(existing.doWork?.models?.codex ?? "");
  const [doWorkLockStale, setDoWorkLockStale] = useState(
    String(existing.doWork?.lockStaleMinutes ?? DEFAULT_DO_WORK.lockStaleMinutes),
  );
  const [validationError, setValidationError] = useState("");
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
      onSubmit: () => setScreen("do-work-protected-branches"),
      onBack: () => setScreen("main"),
    },
    "do-work-protected-branches": {
      setValue: (update) => {
        setValidationError("");
        setDoWorkProtectedBranches(update);
      },
      onSubmit: () => {
        if (parseAllowedUsers(doWorkProtectedBranches).length === 0) {
          setValidationError("Enter at least one branch name.");
          return;
        }
        setValidationError("");
        setScreen("do-work-executor");
      },
      onBack: () => setScreen("do-work-base-branch"),
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
      setValue: (update) => {
        setValidationError("");
        setDoWorkMaxRuns(update);
      },
      onSubmit: () => {
        // Rejected in place rather than saved as `undefined`: an omitted cap
        // means *unlimited*, so accepting "2abc" would silently remove the
        // operator's spend limit on a typo.
        const parsed = parseWholeInt(doWorkMaxRuns);
        if (parsed === null || parsed < 0) {
          setValidationError("Enter a non-negative whole number (0 = unlimited).");
          return;
        }
        setValidationError("");
        setScreen("do-work-lock-stale");
      },
      onBack: () => setScreen("do-work-codex-model"),
    },
    "do-work-lock-stale": {
      setValue: (update) => {
        setValidationError("");
        setDoWorkLockStale(update);
      },
      onSubmit: () => {
        const parsed = parseWholeInt(doWorkLockStale);
        if (parsed === null || parsed <= 0) {
          setValidationError("Enter a whole number of minutes greater than zero.");
          return;
        }
        const maxRuns = parseWholeInt(doWorkMaxRuns);
        const current = readRawConfig();
        writeConfig({
          ...current,
          doWork: {
            ...current.doWork,
            baseBranch: doWorkBaseBranch.trim() || undefined,
            protectedBranches: parseAllowedUsers(doWorkProtectedBranches),
            executor: EXECUTOR_OPTIONS[doWorkExecutorIndex].value,
            models: {
              claude: doWorkClaudeModel.trim() || undefined,
              codex: doWorkCodexModel.trim() || undefined,
            },
            maxRunsPerTick: maxRuns ?? undefined,
            lockStaleMinutes: parsed,
          },
        });
        exit();
      },
      onBack: () => setScreen("do-work-max-runs"),
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

  /** The arrow-navigated screens, described the same way as the text ones. */
  const menus: Partial<Record<Screen, MenuScreen>> = {
    main: {
      index: mainMenuIndex,
      length: MAIN_MENU_OPTIONS.length,
      setIndex: setMainMenuIndex,
      onSelect: () => {
        const chosen = MAIN_MENU_OPTIONS[mainMenuIndex];
        if (chosen === "Remote / Mode") setScreen("remote");
        else if (chosen === "Implement-Next") setScreen("technique");
        else if (chosen === "Issue Watch") setScreen("allowed-users");
        else if (chosen === "Do Work") setScreen("do-work-base-branch");
        else setScreen("prompts-menu");
      },
    },
    remote: {
      index: selectedRemoteIndex,
      length: REMOTE_OPTIONS.length,
      setIndex: setSelectedRemoteIndex,
      onSelect: () => {
        setPendingRemote(REMOTE_OPTIONS[selectedRemoteIndex].value);
        setScreen("technique");
      },
      onBack: () => setScreen("main"),
    },
    technique: {
      index: selectedTechIndex,
      length: TECHNIQUE_OPTIONS.length,
      setIndex: setSelectedTechIndex,
      onSelect: () => {
        setPendingTechnique(TECHNIQUE_OPTIONS[selectedTechIndex].value);
        setScreen("value");
      },
      onBack: () => setScreen("main"),
    },
    "prompts-menu": {
      index: promptsMenuIndex,
      length: PROMPTS_MENU_OPTIONS.length,
      setIndex: setPromptsMenuIndex,
      onSelect: () => setScreen(PROMPT_SCREEN_BY_OPTION[PROMPTS_MENU_OPTIONS[promptsMenuIndex]]),
      onBack: () => setScreen("main"),
    },
    "do-work-executor": {
      index: doWorkExecutorIndex,
      length: EXECUTOR_OPTIONS.length,
      setIndex: setDoWorkExecutorIndex,
      onSelect: () => setScreen("do-work-claude-model"),
      onBack: () => setScreen("do-work-protected-branches"),
    },
  };

  useInput((input, key) => {
    const textScreen = textScreens[screen];
    if (textScreen) {
      handleTextEntry(input, key, textScreen, exit);
      return;
    }

    const menu = menus[screen];
    if (menu) {
      handleMenu(input, key, menu, exit);
    }
  });

  const techLabel = TECHNIQUE_OPTIONS.find((o) => o.value === pendingTechnique)?.label ?? pendingTechnique;

  /**
   * The text-entry screens as data. Sixteen near-identical JSX blocks were what
   * pushed this component past its complexity budget; the shape lives once, in
   * `TextEntryScreen`.
   */
  const textViews: Partial<Record<Screen, TextView>> = {
    value: {
      title: "Implement-Next — Issue Discovery Value",
      label: `${techLabel} value:`,
      value: discoveryValue,
      hint: `Type value · Enter to continue · ${BACK}`,
    },
    "system-prompt": {
      title: "Implement-Next — Claude System Prompt",
      label: "System prompt (optional):",
      value: systemPrompt,
      hint: `Type prompt · Enter to save and exit · ${BACK}`,
    },
    "sonar-prompt": {
      title: "Prompts — Sonar",
      label: "Sonar prompt:",
      value: sonarPrompt,
      hint: `Type prompt · Enter to save · ${BACK}`,
    },
    "fix-comments-prompt": {
      title: "Prompts — Fix-Comments",
      label: "Fix-Comments prompt:",
      value: fixCommentsPrompt,
      hint: `Type prompt · Enter to save · ${BACK}`,
    },
    "check-issue-prompt": {
      title: "Prompts — Check-Issue",
      label: "Check-Issue prompt:",
      value: checkIssuePrompt,
      hint: `Type prompt · Enter to save · ${BACK}`,
    },
    "allowed-users": {
      title: "Issue Watch — Allowed Users",
      label: "Logins allowed to instruct the agent (comma separated):",
      value: allowedUsers,
      hint: `Type logins · Enter to continue · ${BACK}`,
    },
    "agent-user": {
      title: "Issue Watch — Agent User",
      label: "Login the agent posts as:",
      value: agentUser,
      hint: `Type login · Enter to save and exit · ${BACK}`,
    },
    "do-work-base-branch": {
      title: "Do Work — Base Branch",
      label: "Branch discussion turns return to:",
      value: doWorkBaseBranch,
      hint: `Type branch · Enter to continue · ${BACK}`,
    },
    "do-work-protected-branches": {
      title: "Do Work — Protected Branches",
      label: "Branches a build turn must never push to (comma separated):",
      value: doWorkProtectedBranches,
      hint: `Type branches · Enter to continue · ${BACK}`,
    },
    "do-work-claude-model": {
      title: "Do Work — Claude Model",
      label: "Default model when the executor is Claude (blank = the executor's own default):",
      value: doWorkClaudeModel,
      hint: `Type model · Enter to continue · ${BACK}`,
    },
    "do-work-codex-model": {
      title: "Do Work — Codex Model",
      label: "Default model when the executor is Codex (blank = the executor's own default):",
      value: doWorkCodexModel,
      hint: `Type model · Enter to continue · ${BACK}`,
    },
    "do-work-max-runs": {
      title: "Do Work — Max Runs Per Tick",
      label: "Model runs allowed per tick (0 = unlimited):",
      value: doWorkMaxRuns,
      hint: `Type a number · Enter to continue · ${BACK}`,
    },
    "do-work-lock-stale": {
      title: "Do Work — Lock Staleness",
      label: "Minutes before a run lock from another host is treated as stale:",
      value: doWorkLockStale,
      hint: `Type a number · Enter to save · ${BACK}`,
    },
    "do-work-discuss-prompt": {
      title: "Prompts — Do Work — Discuss",
      label: "Discussion turn instructions:",
      value: doWorkDiscussPrompt,
      hint: `Type prompt · Enter to save · ${BACK}`,
    },
    "do-work-pr-prompt": {
      title: "Prompts — Do Work — PR",
      label: "Pull request turn instructions:",
      value: doWorkPrPrompt,
      hint: `Type prompt · Enter to save · ${BACK}`,
    },
  };

  const menuViews: Partial<Record<Screen, MenuView>> = {
    main: {
      title: "Configure Automata",
      options: MAIN_MENU_OPTIONS,
      index: mainMenuIndex,
      hint: "↑/↓ to move · Enter to select · Ctrl+C to cancel",
    },
    remote: {
      title: "Remote / Mode",
      options: REMOTE_OPTIONS.map((o) => o.label),
      index: selectedRemoteIndex,
      hint: `↑/↓ to move · Enter to confirm · ${BACK}`,
    },
    technique: {
      title: "Implement-Next — Issue Discovery Technique",
      options: TECHNIQUE_OPTIONS.map((o) => o.label),
      index: selectedTechIndex,
      hint: `↑/↓ to move · Enter to confirm · ${BACK}`,
    },
    "prompts-menu": {
      title: "Prompts",
      options: PROMPTS_MENU_OPTIONS,
      index: promptsMenuIndex,
      hint: `↑/↓ to move · Enter to edit · ${BACK}`,
    },
    "do-work-executor": {
      title: "Do Work — Executor",
      options: EXECUTOR_OPTIONS.map((o) => o.label),
      index: doWorkExecutorIndex,
      hint: `↑/↓ to move · Enter to continue · ${BACK}`,
    },
  };

  const textView = textViews[screen];
  if (textView) return <TextEntryScreen {...textView} error={validationError} />;

  const menuView = menuViews[screen];
  if (menuView) return <MenuEntryScreen {...menuView} />;

  // Every screen in the union is covered above; this keeps the type exhaustive
  // rather than falling through to whichever block happened to be last.
  return null;
}
