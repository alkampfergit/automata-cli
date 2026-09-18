import { describe, it, expect } from "vitest";
import { identityProblemFor } from "../../src/github/identity.js";

const AGENT = "automata-bot";
const ALLOWED = ["alice", "bob"];

describe("identityProblemFor", () => {
  it("accepts the agent account", () => {
    expect(identityProblemFor(AGENT, AGENT, ALLOWED)).toBeNull();
  });

  it("accepts the agent account whatever its case", () => {
    expect(identityProblemFor("Automata-Bot", AGENT, ALLOWED)).toBeNull();
  });

  it("accepts an unverifiable identity", () => {
    // A GitHub App installation token has no user. Refusing on that would stop
    // a correctly configured loop.
    expect(identityProblemFor(null, AGENT, ALLOWED)).toBeNull();
  });

  it("refuses an account that is listed in allowedUsers", () => {
    const problem = identityProblemFor("alice", AGENT, ALLOWED);
    expect(problem).toContain("listed in allowedUsers");
    expect(problem).toContain("answer the previous tick forever");
  });

  it("refuses an account that is neither the agent nor authorized", () => {
    const problem = identityProblemFor("mallory", AGENT, ALLOWED);
    expect(problem).toContain('but agentUser is "automata-bot"');
    expect(problem).toContain("filtered out of the conversation");
  });

  it("matches allowedUsers case-insensitively", () => {
    expect(identityProblemFor("ALICE", AGENT, ALLOWED)).toContain("listed in allowedUsers");
  });
});
