import { describe, expect, it } from "vitest";
import { azdoUnsupportedMessage, isAzdo, isExplicitGitHub, selectBackend } from "../../src/remote/backend.js";

describe("selectBackend", () => {
  it("defaults to gh when the key is absent", () => {
    expect(selectBackend({})).toBe("gh");
    expect(isAzdo({})).toBe(false);
    expect(isExplicitGitHub({})).toBe(false);
  });
  it("selects each explicit backend", () => {
    expect(selectBackend({ remoteType: "gh" })).toBe("gh");
    expect(isExplicitGitHub({ remoteType: "gh" })).toBe(true);
    expect(selectBackend({ remoteType: "azdo" })).toBe("azdo");
    expect(isAzdo({ remoteType: "azdo" })).toBe(true);
  });
  it("builds the unsupported message with the gap doc link", () => {
    expect(azdoUnsupportedMessage("check-issue")).toBe(
      "check-issue is not supported for Azure DevOps. See docs/azdo-gap.md for details.",
    );
    expect(azdoUnsupportedMessage("x", "Why.")).toContain("Why. See docs/azdo-gap.md");
  });
});
