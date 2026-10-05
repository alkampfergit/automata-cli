import type { Executor } from "../config/configStore.js";

/**
 * Read the reply out of a dry run's captured stdout. Claude prints stream-json,
 * and its `result` event holds the final message; Codex prints the message as
 * plain text. Pure: the caller collects the text.
 */

function claudeResult(raw: string): string | null {
  let result: string | null = null;
  for (const line of raw.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event["type"] === "result" && typeof event["result"] === "string") result = event["result"];
    } catch {
      // not JSON: skip, as the live run does
    }
  }
  return result;
}

/** The reply text, or null when the run printed none. */
export function extractDryRunReply(executor: Executor, stdout: string): string | null {
  const text = (executor === "claude" ? claudeResult(stdout) : stdout)?.trim();
  return text === undefined || text.length === 0 ? null : text;
}
