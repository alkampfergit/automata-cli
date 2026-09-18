import { describe, it, expect, vi } from "vitest";

import { resolveReleaseVersion } from "../../src/git/releaseVersion.js";

describe("resolveReleaseVersion", () => {
  it("accepts a well-formed explicit version without looking up a tag", () => {
    const latestTag = vi.fn(() => "1.2.0");
    expect(resolveReleaseVersion("2.0.0", "origin/main", latestTag)).toEqual({
      ok: true,
      version: "2.0.0",
      notice: null,
    });
    expect(latestTag).not.toHaveBeenCalled();
  });

  it("rejects an explicit version that is not X.Y.Z", () => {
    const result = resolveReleaseVersion("v1.2", "origin/main", () => null);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("'v1.2' is not valid semver");
  });

  it("bumps the minor segment of the latest tag when no version is given", () => {
    expect(resolveReleaseVersion(undefined, "origin/main", () => "1.2.5")).toEqual({
      ok: true,
      version: "1.3.0",
      notice: "Auto-detected version: 1.2.5 → 1.3.0",
    });
  });

  it("names the trunk ref when it carries no semver tag", () => {
    const result = resolveReleaseVersion(undefined, "origin/trunk", () => null);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("No semver tag found on origin/trunk");
    expect(result.ok === false && result.message).not.toContain("master");
  });
});
