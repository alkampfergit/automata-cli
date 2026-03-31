import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

describe("automata test (CLI smoke)", () => {
  it("shows help for test command group", () => {
    const output = execSync(`"${process.execPath}" dist/index.js test --help`, { encoding: "utf8" });
    expect(output).toContain("claude");
    expect(output).toContain("Test commands for verifying automata integrations");
  });

  it("shows help for test claude subcommand", () => {
    const output = execSync(`"${process.execPath}" dist/index.js test claude --help`, { encoding: "utf8" });
    expect(output).toContain("--prompt");
    expect(output).toContain("--yolo");
    expect(output).toContain("--verbose");
  });

  it("is listed in the top-level help", () => {
    const output = execSync(`"${process.execPath}" dist/index.js --help`, { encoding: "utf8" });
    expect(output).toContain("test");
  });
});
