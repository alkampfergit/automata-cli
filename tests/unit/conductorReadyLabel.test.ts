import { describe, expect, it } from "vitest";
import type { CiCheck, PrSurface } from "../../src/github/ghWorkService.js";
import { isReady, readyLabelChange } from "../../src/conductor/readyLabel.js";

function surface(overrides: Partial<PrSurface["pr"]> = {}, threads: PrSurface["threads"] = []): PrSurface {
  return {
    pr: {
      number: 7,
      url: "u",
      title: "t",
      headRefName: "h",
      baseRefName: "develop",
      isCrossRepository: false,
      state: "OPEN",
      isDraft: false,
      updatedAt: "2026-10-19T00:00:00Z",
      mergeable: "MERGEABLE",
      labels: [],
      ...overrides,
    },
    assignees: [],
    messages: [],
    threads,
  };
}

const green: CiCheck[] = [{ name: "build", status: "COMPLETED", conclusion: "SUCCESS" }];

describe("isReady", () => {
  it("is ready: open, not draft, no conflict, no thread, green checks", () => {
    expect(isReady(surface(), green)).toBe(true);
  });

  it("counts skipped and neutral checks as green", () => {
    const checks: CiCheck[] = [...green, { name: "x", status: "COMPLETED", conclusion: "SKIPPED" }, { name: "y", status: "COMPLETED", conclusion: "NEUTRAL" }];
    expect(isReady(surface(), checks)).toBe(true);
  });

  it.each([
    ["a draft", surface({ isDraft: true }), green],
    ["a conflict", surface({ mergeable: "CONFLICTING" }), green],
    ["a closed pull request", surface({ state: "CLOSED" }), green],
    ["a merged pull request", surface({ state: "MERGED" }), green],
    ["an unresolved thread", surface({}, [{} as PrSurface["threads"][number]]), green],
    ["a failed check", surface(), [...green, { name: "l", status: "COMPLETED", conclusion: "FAILURE" }]],
    ["a pending check", surface(), [...green, { name: "l", status: "IN_PROGRESS", conclusion: null }]],
    ["no check", surface(), []],
    ["the blocked label on the pull request", surface({ labels: ["Conductor-Blocked"] }), green],
  ])("is not ready with %s", (_name, pr, checks) => {
    expect(isReady(pr, checks)).toBe(false);
  });

  it("is not ready when the watched item carries the blocked label", () => {
    expect(isReady(surface(), green, ["conductor-blocked"])).toBe(false);
  });

  it("does not need an approving review and ignores an unknown merge state", () => {
    expect(isReady(surface({ mergeable: "UNKNOWN" }), green)).toBe(true);
  });
});

describe("readyLabelChange", () => {
  it("adds the label to a ready pull request without it", () => {
    expect(readyLabelChange(surface(), green)).toBe("add");
  });

  it("does nothing for a ready pull request with the label", () => {
    expect(readyLabelChange(surface({ labels: ["conductor-ready"] }), green)).toBeNull();
  });

  it("removes the label when the pull request is no longer ready", () => {
    const failed: CiCheck[] = [{ name: "b", status: "COMPLETED", conclusion: "FAILURE" }];
    expect(readyLabelChange(surface({ labels: ["conductor-ready"] }), failed)).toBe("remove");
  });

  it("does nothing for a pull request that is not ready and has no label", () => {
    expect(readyLabelChange(surface({ isDraft: true }), green)).toBeNull();
  });
});
