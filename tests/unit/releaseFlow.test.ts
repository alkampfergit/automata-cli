import { describe, it, expect } from "vitest";
import {
  RELEASE_FLOWS,
  describeReleaseFlowSource,
  invalidReleaseFlowMessage,
  isReleaseFlow,
  planRelease,
} from "../../src/git/releaseFlow.js";

describe("isReleaseFlow", () => {
  it("accepts exactly the two flows", () => {
    expect(RELEASE_FLOWS).toEqual(["gitflow", "trunk"]);
    expect(isReleaseFlow("gitflow")).toBe(true);
    expect(isReleaseFlow("trunk")).toBe(true);
  });

  it.each([["GitFlow"], ["trunk-based"], [""], [undefined], [1]])("rejects %j", (value) => {
    expect(isReleaseFlow(value)).toBe(false);
  });
});

describe("describeReleaseFlowSource", () => {
  it("names the config key, or what detection saw", () => {
    expect(describeReleaseFlowSource("config")).toBe("configured as git.releaseFlow");
    expect(describeReleaseFlowSource("develop-present")).toBe("detected: origin/develop exists");
    expect(describeReleaseFlowSource("develop-absent")).toBe("detected: origin/develop does not exist");
  });
});

describe("invalidReleaseFlowMessage", () => {
  it("names the bad value, the accepted ones and the setter", () => {
    const message = invalidReleaseFlowMessage("trunk-based");
    expect(message).toContain('"trunk-based"');
    expect(message).toContain("git.releaseFlow");
    expect(message).toContain("gitflow, trunk");
    expect(message).toContain("automata config set git-release-flow");
  });
});

describe("planRelease", () => {
  const descs = (steps: { desc: string }[]) => steps.map((s) => s.desc);

  it("gitflow: the unchanged sequence, checking out an existing local trunk", () => {
    expect(descs(planRelease("gitflow", "1.3.0", "master", true))).toEqual([
      "git checkout -b release/1.3.0",
      "git checkout master",
      "git merge --no-ff release/1.3.0",
      "git tag 1.3.0",
      "git checkout develop",
      "git merge --no-ff release/1.3.0",
      "git branch -d release/1.3.0",
      "git push origin develop master 1.3.0",
    ]);
  });

  it("gitflow: creates the local trunk from origin, without --track", () => {
    const steps = planRelease("gitflow", "1.3.0", "main", false);
    expect(steps[1]).toEqual({
      args: ["checkout", "-b", "main", "origin/main"],
      desc: "git checkout -b main origin/main",
    });
  });

  it("trunk: an empty release commit, a tag and one atomic push — nothing else", () => {
    const steps = planRelease("trunk", "1.3.0", "main", true);
    expect(steps).toEqual([
      {
        args: ["commit", "--allow-empty", "-m", "chore(release): 1.3.0"],
        desc: 'git commit --allow-empty -m "chore(release): 1.3.0"',
      },
      { args: ["tag", "1.3.0"], desc: "git tag 1.3.0" },
      { args: ["push", "--atomic", "origin", "main", "1.3.0"], desc: "git push --atomic origin main 1.3.0" },
    ]);
    const flat = steps.flatMap((s) => s.args);
    expect(flat).not.toContain("develop");
    expect(flat).not.toContain("merge");
    expect(flat.some((arg) => arg.startsWith("release/"))).toBe(false);
  });

  it("trunk: the plan does not depend on whether the trunk is local", () => {
    expect(planRelease("trunk", "2.0.0", "master", false)).toEqual(planRelease("trunk", "2.0.0", "master", true));
  });
});
