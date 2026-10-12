import { describe, it, expect } from "vitest";
import { describePermissionDenials, parsePermissionDenials } from "../../src/conductor/permissionDenials.js";

const result = (denials: unknown) => JSON.stringify({ type: "result", result: "x", permission_denials: denials }) + "\n";

describe("parsePermissionDenials", () => {
  it("reads the shape Claude Code 2.1.285 prints in the result event (captured from a real dontAsk run)", () => {
    const real = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      permission_denials: [
        {
          tool_name: "Bash",
          tool_use_id: "toolu_01Ck9vGd5XqM2ZYYVmgB2Vu1",
          tool_input: { command: "gh issue comment 94 --body hello", description: "Post a comment on issue 94" },
        },
      ],
    });
    expect(parsePermissionDenials(real + "\n")).toEqual([{ tool: "Bash", target: "gh issue comment 94 --body hello" }]);
  });

  it("reads the command of a denied Bash call and the path of a denied file tool", () => {
    const out = result([
      { tool_name: "Bash", tool_input: { command: "gh issue comment 94 --body hi" } },
      { tool_name: "Write", tool_input: { file_path: "/tmp/a" } },
    ]);
    expect(parsePermissionDenials(out)).toEqual([
      { tool: "Bash", target: "gh issue comment 94 --body hi" },
      { tool: "Write", target: "/tmp/a" },
    ]);
  });

  it("falls back to the input as JSON, and skips malformed entries, other events and non-JSON lines", () => {
    const out = [
      "not json",
      JSON.stringify({ type: "assistant", permission_denials: [{ tool_name: "Bash" }] }),
      result([{ tool_name: "Task", tool_input: { a: 1 } }, 3, { tool_input: {} }]),
    ].join("\n");
    expect(parsePermissionDenials(out)).toEqual([{ tool: "Task", target: '{"a":1}' }]);
  });

  it("returns nothing when the result lists no denials", () => {
    expect(parsePermissionDenials(result([]))).toEqual([]);
    expect(parsePermissionDenials(JSON.stringify({ type: "result", result: "x" }))).toEqual([]);
  });
});

describe("describePermissionDenials", () => {
  it("flattens line breaks and cuts a long command", () => {
    const lines = describePermissionDenials([
      { tool: "Bash", target: "gh issue comment\n94" },
      { tool: "Bash", target: "x".repeat(500) },
    ]);
    expect(lines[0]).toBe("Bash gh issue comment 94");
    expect(lines[1]).toHaveLength(301);
    expect(lines[1]?.endsWith("…")).toBe(true);
  });
});
