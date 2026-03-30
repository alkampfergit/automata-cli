import React, { useState } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { readConfig, writeConfig, type RemoteType } from "./configStore.js";

const OPTIONS: { label: string; value: RemoteType }[] = [
  { label: "GitHub", value: "gh" },
  { label: "Azure DevOps", value: "azdo" },
];

export function ConfigWizard() {
  const existing = readConfig();
  const initialIndex = OPTIONS.findIndex((o) => o.value === existing.remoteType);
  const [selectedIndex, setSelectedIndex] = useState(initialIndex >= 0 ? initialIndex : 0);
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((i) => (i > 0 ? i - 1 : OPTIONS.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => (i < OPTIONS.length - 1 ? i + 1 : 0));
    } else if (key.return) {
      const chosen = OPTIONS[selectedIndex];
      writeConfig({ ...existing, remoteType: chosen.value });
      exit();
    } else if (key.escape || (key.ctrl && input === "c")) {
      exit();
    }
  });

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold>Configure Automata</Text>
      <Text> </Text>
      <Text>Remote environment type:</Text>
      {OPTIONS.map((option, index) => (
        <Box key={option.value}>
          <Text color={index === selectedIndex ? "cyan" : undefined}>
            {index === selectedIndex ? "❯ " : "  "}
            {option.label}
          </Text>
        </Box>
      ))}
      <Text> </Text>
      <Text dimColor>↑/↓ to move · Enter to confirm · Ctrl+C to cancel</Text>
    </Box>
  );
}
