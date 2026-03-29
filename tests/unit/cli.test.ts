import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

describe("automata CLI", () => {
  it("should display help when run without arguments", () => {
    const output = execSync("node dist/index.js --help", { encoding: "utf8" });
    expect(output).toContain("automata");
    expect(output).toContain("Automata CLI tool");
  });

  it("should display version", () => {
    const output = execSync("node dist/index.js --version", { encoding: "utf8" });
    expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
