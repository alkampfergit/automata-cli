import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readConfig, readRawConfig, writeConfig, resolvePromptRef } from "../../src/config/configStore.js";

const TEST_DIR = join(process.cwd(), ".automata-test");

// Redirect config to a test directory by overriding cwd via env
// We instead test via direct import with a patched cwd.
// For simplicity, we write/read from the real .automata dir in a temp location
// by temporarily changing the working directory.

const ORIG_CWD = process.cwd;
const TEST_CWD = join(process.cwd(), "tmp-test-config");

beforeEach(() => {
  mkdirSync(TEST_CWD, { recursive: true });
  process.cwd = () => TEST_CWD;
});

afterEach(() => {
  process.cwd = ORIG_CWD;
  rmSync(TEST_CWD, { recursive: true, force: true });
});

describe("readConfig", () => {
  it("returns empty object when no config file exists", () => {
    expect(readConfig()).toEqual({});
  });

  it("returns parsed config when file exists", () => {
    mkdirSync(join(TEST_CWD, ".automata"), { recursive: true });
    writeFileSync(join(TEST_CWD, ".automata", "config.json"), JSON.stringify({ remoteType: "gh" }));
    expect(readConfig()).toEqual({ remoteType: "gh" });
  });

  it("returns empty object when config file is corrupted", () => {
    mkdirSync(join(TEST_CWD, ".automata"), { recursive: true });
    writeFileSync(join(TEST_CWD, ".automata", "config.json"), "not-json");
    expect(readConfig()).toEqual({});
  });
});

describe("writeConfig", () => {
  it("creates .automata directory and writes config", () => {
    writeConfig({ remoteType: "azdo" });
    const written = readConfig();
    expect(written).toEqual({ remoteType: "azdo" });
    expect(existsSync(join(TEST_CWD, ".automata"))).toBe(true);
  });

  it("overwrites existing config", () => {
    writeConfig({ remoteType: "gh" });
    writeConfig({ remoteType: "azdo" });
    expect(readConfig()).toEqual({ remoteType: "azdo" });
  });
});

describe("new config fields: issueDiscoveryTechnique, issueDiscoveryValue, claudeSystemPrompt", () => {
  it("round-trips issueDiscoveryTechnique", () => {
    writeConfig({ issueDiscoveryTechnique: "label" });
    expect(readConfig()).toEqual({ issueDiscoveryTechnique: "label" });
  });

  it("round-trips issueDiscoveryValue", () => {
    writeConfig({ issueDiscoveryValue: "ready-for-dev" });
    expect(readConfig()).toEqual({ issueDiscoveryValue: "ready-for-dev" });
  });

  it("round-trips claudeSystemPrompt", () => {
    writeConfig({ claudeSystemPrompt: "You are a senior engineer." });
    expect(readConfig()).toEqual({ claudeSystemPrompt: "You are a senior engineer." });
  });

  it("preserves all fields together", () => {
    writeConfig({
      remoteType: "gh",
      issueDiscoveryTechnique: "assignee",
      issueDiscoveryValue: "octocat",
      claudeSystemPrompt: "Focus on tests.",
    });
    expect(readConfig()).toEqual({
      remoteType: "gh",
      issueDiscoveryTechnique: "assignee",
      issueDiscoveryValue: "octocat",
      claudeSystemPrompt: "Focus on tests.",
    });
  });
});

describe("prompts config field", () => {
  it("round-trips prompts.sonar", () => {
    writeConfig({ prompts: { sonar: "Fix all sonar issues." } });
    expect(readConfig()).toEqual({ prompts: { sonar: "Fix all sonar issues." } });
  });

  it("preserves prompts alongside other fields", () => {
    writeConfig({
      remoteType: "gh",
      prompts: { sonar: "Custom sonar prompt." },
    });
    expect(readConfig()).toEqual({
      remoteType: "gh",
      prompts: { sonar: "Custom sonar prompt." },
    });
  });
});

describe("DEFAULT_SONAR_PROMPT", () => {
  it("is exported and non-empty", async () => {
    const { DEFAULT_SONAR_PROMPT } = await import("../../src/config/configStore.js");
    expect(typeof DEFAULT_SONAR_PROMPT).toBe("string");
    expect(DEFAULT_SONAR_PROMPT.length).toBeGreaterThan(0);
  });

  it("mentions the sonar-quality-gate skill and quality gate api usage", async () => {
    const { DEFAULT_SONAR_PROMPT } = await import("../../src/config/configStore.js");
    expect(DEFAULT_SONAR_PROMPT).toContain("sonar-quality-gate");
    expect(DEFAULT_SONAR_PROMPT).toMatch(/quality gate/i);
    expect(DEFAULT_SONAR_PROMPT).toMatch(/issues/i);
  });
});

// Cleanup TEST_DIR if it was accidentally created
afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("resolvePromptRef", () => {
  const dir = join(TEST_CWD, ".automata");

  beforeEach(() => {
    mkdirSync(dir, { recursive: true });
    process.cwd = () => TEST_CWD;
  });

  afterEach(() => {
    process.cwd = ORIG_CWD;
    rmSync(TEST_CWD, { recursive: true, force: true });
  });

  it("returns inline string unchanged when value does not end with .md", () => {
    expect(resolvePromptRef("You are a senior engineer.", dir)).toBe("You are a senior engineer.");
  });

  it("reads and returns file contents when value ends with .md", () => {
    writeFileSync(join(dir, "my-prompt.md"), "Hello prompt");
    expect(resolvePromptRef("my-prompt.md", dir)).toBe("Hello prompt");
  });

  it("throws when referenced .md file does not exist", () => {
    expect(() => resolvePromptRef("missing.md", dir)).toThrow();
  });

  it("throws on path traversal attempt", () => {
    expect(() => resolvePromptRef("../secret.md", dir)).toThrow(/outside .automata/);
  });
});

describe("readConfig with .md file references", () => {
  beforeEach(() => {
    mkdirSync(join(TEST_CWD, ".automata"), { recursive: true });
    process.cwd = () => TEST_CWD;
  });

  afterEach(() => {
    process.cwd = ORIG_CWD;
    rmSync(TEST_CWD, { recursive: true, force: true });
  });

  it("resolves claudeSystemPrompt file reference", () => {
    writeFileSync(join(TEST_CWD, ".automata", "my-prompt.md"), "Resolved content");
    writeFileSync(
      join(TEST_CWD, ".automata", "config.json"),
      JSON.stringify({ claudeSystemPrompt: "my-prompt.md" }),
    );
    expect(readConfig()).toEqual({ claudeSystemPrompt: "Resolved content" });
  });

  it("keeps inline claudeSystemPrompt unchanged", () => {
    writeFileSync(
      join(TEST_CWD, ".automata", "config.json"),
      JSON.stringify({ claudeSystemPrompt: "You are a senior engineer." }),
    );
    expect(readConfig()).toEqual({ claudeSystemPrompt: "You are a senior engineer." });
  });

  it("resolves prompts.sonar file reference", () => {
    writeFileSync(join(TEST_CWD, ".automata", "sonar-prompt.md"), "Fix sonar issues");
    writeFileSync(
      join(TEST_CWD, ".automata", "config.json"),
      JSON.stringify({ prompts: { sonar: "sonar-prompt.md" } }),
    );
    expect(readConfig()).toEqual({ prompts: { sonar: "Fix sonar issues" } });
  });

  it("resolves prompts.fixComments file reference", () => {
    writeFileSync(join(TEST_CWD, ".automata", "fix-comments-prompt.md"), "Fix PR comments");
    writeFileSync(
      join(TEST_CWD, ".automata", "config.json"),
      JSON.stringify({ prompts: { fixComments: "fix-comments-prompt.md" } }),
    );
    expect(readConfig()).toEqual({ prompts: { fixComments: "Fix PR comments" } });
  });

  it("throws when referenced .md file is missing", () => {
    writeFileSync(
      join(TEST_CWD, ".automata", "config.json"),
      JSON.stringify({ claudeSystemPrompt: "nonexistent.md" }),
    );
    expect(() => readConfig()).toThrow();
  });
});

describe("readRawConfig", () => {
  beforeEach(() => {
    mkdirSync(join(TEST_CWD, ".automata"), { recursive: true });
    process.cwd = () => TEST_CWD;
  });

  afterEach(() => {
    process.cwd = ORIG_CWD;
    rmSync(TEST_CWD, { recursive: true, force: true });
  });

  it("returns filename as-is without resolving .md reference", () => {
    writeFileSync(
      join(TEST_CWD, ".automata", "config.json"),
      JSON.stringify({ claudeSystemPrompt: "my-prompt.md" }),
    );
    expect(readRawConfig()).toEqual({ claudeSystemPrompt: "my-prompt.md" });
  });

  it("returns empty object when no config exists", () => {
    expect(readRawConfig()).toEqual({});
  });
});
