import { describe, expect, it } from "vitest";
import { parseAzdoOrigin, parseOrigin } from "../../src/remote/originUrl.js";

const azdo = (organization: string, project: string, repo: string) => ({ kind: "azdo", organization, project, repo });

describe("parseOrigin", () => {
  it("parses dev.azure.com https", () => {
    expect(parseOrigin("https://dev.azure.com/acme/Proj/_git/repo")).toEqual(azdo("acme", "Proj", "repo"));
  });
  it("parses https with a user prefix and encoded project", () => {
    expect(parseOrigin("https://acme@dev.azure.com/acme/My%20Proj/_git/repo")).toEqual(azdo("acme", "My Proj", "repo"));
  });
  it("parses visualstudio.com", () => {
    expect(parseOrigin("https://acme.visualstudio.com/Proj/_git/repo")).toEqual(azdo("acme", "Proj", "repo"));
    expect(parseOrigin("https://acme.visualstudio.com/DefaultCollection/Proj/_git/repo")).toEqual(
      azdo("acme", "Proj", "repo"),
    );
  });
  it("parses ssh", () => {
    expect(parseOrigin("git@ssh.dev.azure.com:v3/acme/Proj/repo")).toEqual(azdo("acme", "Proj", "repo"));
  });
  it("parses GitHub https and ssh", () => {
    expect(parseOrigin("https://github.com/o/r.git")).toEqual({ kind: "github", owner: "o", repo: "r" });
    expect(parseOrigin("git@github.com:o/r.git")).toEqual({ kind: "github", owner: "o", repo: "r" });
  });
  it("returns null for unknown hosts and parseAzdoOrigin ignores GitHub", () => {
    expect(parseOrigin("https://example.com/a/b")).toBeNull();
    expect(parseAzdoOrigin("https://github.com/o/r")).toBeNull();
  });
});
