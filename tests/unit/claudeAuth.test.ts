import { describe, expect, it } from "vitest";
import {
  CLAUDE_AUTH_MARKER,
  detectClaudeAuthFailure,
  renderClaudeAuthComment,
} from "../../src/run/claudeAuth.js";

describe("detectClaudeAuthFailure", () => {
  it("detects the message from issue #140", () => {
    expect(
      detectClaudeAuthFailure("Failed to authenticate: OAuth session expired and could not be refreshed"),
    ).toBe(true);
  });

  it("detects the message inside a longer transcript", () => {
    expect(detectClaudeAuthFailure("starting\nAPI Error: OAuth token expired\n")).toBe(true);
  });

  it("does not flag ordinary output", () => {
    expect(detectClaudeAuthFailure("All tests passed. Exit code 1 from a test run.")).toBe(false);
  });
});

describe("renderClaudeAuthComment", () => {
  it("names the fix, carries the marker and never says 'terminated unexpectedly'", () => {
    const body = renderClaudeAuthComment("issue #42", "Failed to authenticate");
    expect(body).toContain("claude /login");
    expect(body).toContain(CLAUDE_AUTH_MARKER);
    expect(body).not.toMatch(/terminated unexpectedly/);
    expect(body).toContain("Failed to authenticate");
  });
});
