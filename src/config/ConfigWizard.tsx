import React, { useState } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { readConfig, writeConfig, type RemoteType, type IssueDiscoveryTechnique } from "./configStore.js";

const REMOTE_OPTIONS: { label: string; value: RemoteType }[] = [
  { label: "GitHub", value: "gh" },
  { label: "Azure DevOps", value: "azdo" },
];

const TECHNIQUE_OPTIONS: { label: string; value: IssueDiscoveryTechnique }[] = [
  { label: "By Label", value: "label" },
  { label: "By Assignee", value: "assignee" },
  { label: "By Title Contains", value: "title-contains" },
];

type Screen = "remote" | "technique" | "value" | "system-prompt";

export function ConfigWizard() {
  const existing = readConfig();
  const initialRemoteIndex = REMOTE_OPTIONS.findIndex((o) => o.value === existing.remoteType);
  const initialTechIndex = TECHNIQUE_OPTIONS.findIndex((o) => o.value === existing.issueDiscoveryTechnique);

  const [screen, setScreen] = useState<Screen>("remote");
  const [selectedRemoteIndex, setSelectedRemoteIndex] = useState(initialRemoteIndex >= 0 ? initialRemoteIndex : 0);
  const [selectedTechIndex, setSelectedTechIndex] = useState(initialTechIndex >= 0 ? initialTechIndex : 0);
  const [discoveryValue, setDiscoveryValue] = useState(existing.issueDiscoveryValue ?? "");
  const [systemPrompt, setSystemPrompt] = useState(existing.claudeSystemPrompt ?? "");
  const [pendingRemote, setPendingRemote] = useState<RemoteType>(existing.remoteType ?? "gh");
  const [pendingTechnique, setPendingTechnique] = useState<IssueDiscoveryTechnique>(
    existing.issueDiscoveryTechnique ?? "label",
  );
  const { exit } = useApp();

  useInput((input, key) => {
    if (screen === "remote") {
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
          writeConfig({ ...existing, remoteType: chosen.value });
          exit();
        }
      } else if (key.escape || (key.ctrl && input === "c")) {
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
      } else if (key.escape || (key.ctrl && input === "c")) {
        exit();
      }
    } else if (screen === "value") {
      if (key.return) {
        setScreen("system-prompt");
      } else if (key.backspace || key.delete) {
        setDiscoveryValue((v) => v.slice(0, -1));
      } else if (key.escape || (key.ctrl && input === "c")) {
        exit();
      } else if (input && !key.ctrl && !key.meta) {
        setDiscoveryValue((v) => v + input);
      }
    } else if (screen === "system-prompt") {
      if (key.return) {
        writeConfig({
          ...existing,
          remoteType: pendingRemote,
          issueDiscoveryTechnique: pendingTechnique,
          issueDiscoveryValue: discoveryValue || undefined,
          claudeSystemPrompt: systemPrompt || undefined,
        });
        exit();
      } else if (key.backspace || key.delete) {
        setSystemPrompt((v) => v.slice(0, -1));
      } else if (key.escape || (key.ctrl && input === "c")) {
        exit();
      } else if (input && !key.ctrl && !key.meta) {
        setSystemPrompt((v) => v + input);
      }
    }
  });

  if (screen === "remote") {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold>Configure Automata</Text>
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
        <Text dimColor>↑/↓ to move · Enter to confirm · Ctrl+C to cancel</Text>
      </Box>
    );
  }

  if (screen === "technique") {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold>Configure Issue Discovery Technique</Text>
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
        <Text dimColor>↑/↓ to move · Enter to confirm · Ctrl+C to cancel</Text>
      </Box>
    );
  }

  if (screen === "value") {
    const techLabel = TECHNIQUE_OPTIONS.find((t) => t.value === pendingTechnique)?.label ?? pendingTechnique;
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold>Configure Issue Discovery Value</Text>
        <Text> </Text>
        <Text>
          {techLabel} value:{" "}
          <Text color="cyan">
            {discoveryValue}
            <Text>_</Text>
          </Text>
        </Text>
        <Text> </Text>
        <Text dimColor>Type value · Enter to confirm · Ctrl+C to cancel</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold>Configure Claude System Prompt</Text>
      <Text> </Text>
      <Text>
        System prompt (optional):{" "}
        <Text color="cyan">
          {systemPrompt}
          <Text>_</Text>
        </Text>
      </Text>
      <Text> </Text>
      <Text dimColor>Type prompt · Enter to save and exit · Ctrl+C to cancel</Text>
    </Box>
  );
}
