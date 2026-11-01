import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRaw = vi.fn();
const mockState = vi.fn();
const mockAdd = vi.fn();

vi.mock("../../src/config/configStore.js", () => ({ readRawConfig: () => mockRaw() }));
vi.mock("../../src/config/githubService.js", () => ({ addCopilotReviewer: (...a: unknown[]) => mockAdd(...a) }));
vi.mock("../../src/github/ghWorkService.js", () => ({ getPrNumberAndState: (...a: unknown[]) => mockState(...a) }));

import { runRequestCopilotReview } from "../../src/commands/requestCopilotReview.js";

let out = "";
let err = "";
beforeEach(() => {
  out = "";
  err = "";
  mockRaw.mockReturnValue({ remoteType: "gh" });
  mockState.mockReturnValue({ number: 12, state: "OPEN" });
  vi.spyOn(process.stdout, "write").mockImplementation((s) => ((out += String(s)), true));
  vi.spyOn(process.stderr, "write").mockImplementation((s) => ((err += String(s)), true));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("git request-copilot-review", () => {
  it("requests a review of the pull request of the current branch", () => {
    expect(runRequestCopilotReview()).toBe(0);
    expect(mockState).toHaveBeenCalledWith(undefined);
    expect(mockAdd).toHaveBeenCalledWith(12);
    expect(out).toMatch(/Requested a Copilot review of pull request #12/);
  });

  it("takes a number, with or without #", () => {
    runRequestCopilotReview("#7");
    expect(mockState).toHaveBeenCalledWith(7);
  });

  it("fails for a bad number, a closed pull request, a failed request and Azure DevOps", () => {
    expect(runRequestCopilotReview("x")).toBe(1);
    mockState.mockReturnValue({ number: 12, state: "MERGED" });
    expect(runRequestCopilotReview()).toBe(1);
    expect(err).toMatch(/merged/);
    mockState.mockReturnValue({ number: 12, state: "OPEN" });
    mockAdd.mockImplementation(() => {
      throw new Error("denied");
    });
    expect(runRequestCopilotReview()).toBe(1);
    expect(err).toMatch(/denied/);
    mockRaw.mockReturnValue({ remoteType: "azdo" });
    expect(runRequestCopilotReview()).toBe(1);
    expect(err).toMatch(/Azure DevOps/);
  });
});
