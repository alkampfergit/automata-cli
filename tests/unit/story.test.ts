import { describe, it, expect } from "vitest";
import { describeChild, parseTaskList, planStory, storyDoneComment, storyLines, type StoryChild } from "../../src/conductor/story.js";

const label = { technique: "label", value: "automata" } as const;

function child(number: number, patch: Partial<StoryChild> = {}): StoryChild {
  return { number, title: `T${String(number)}`, state: "open", labels: [], assignees: [], openPrs: [], ...patch };
}

describe("parseTaskList", () => {
  const repo = { owner: "acme", repo: "widget" };

  it("reads #N and same-repository URLs in order, with either checkbox state", () => {
    const body = [
      "Intro #99",
      "- [ ] #12 first",
      "* [x] https://github.com/Acme/widget/issues/7.",
      "  - [X] #3",
      "- [ ] #12 again",
    ].join("\n");
    expect(parseTaskList(body, repo)).toEqual([12, 7, 3]);
  });

  it("ignores plain text, other repositories and items without a number", () => {
    const body = "- [ ] https://github.com/other/widget/issues/5\n- [ ] write docs\n- #4\n";
    expect(parseTaskList(body, repo)).toEqual([]);
  });
});

describe("planStory", () => {
  it("has nothing to do for no children", () => {
    expect(planStory([], label)).toEqual({ action: "empty", current: null, statuses: [] });
  });

  it("completes when every child is closed", () => {
    const plan = planStory([child(1, { state: "closed" }), child(2, { state: "closed" })], label);
    expect(plan.action).toBe("complete");
    expect(plan.statuses).toEqual(["closed", "closed"]);
  });

  it("starts the first open child and queues the rest, skipping closed ones", () => {
    const plan = planStory([child(1, { state: "closed" }), child(2), child(3)], label);
    expect(plan.action).toBe("start");
    expect(plan.current?.number).toBe(2);
    expect(plan.statuses).toEqual(["closed", "next", "queued"]);
  });

  it("waits while the first open child has an open pull request", () => {
    const plan = planStory([child(1, { openPrs: [9] }), child(2)], label);
    expect(plan.action).toBe("wait");
    expect(plan.statuses).toEqual(["in-review", "queued"]);
  });

  it("waits for a child that carries the discovery label, or the assignee", () => {
    expect(planStory([child(1, { labels: ["automata"] })], label).statuses).toEqual(["started"]);
    const byAssignee = planStory([child(1, { assignees: ["bot"] })], { technique: "assignee", value: "bot" });
    expect(byAssignee.action).toBe("wait");
    expect(planStory([child(1, { labels: ["automata"] })], { technique: "title-contains", value: "x" }).action).toBe("start");
  });

  it("stops at a blocked child and never skips it", () => {
    const plan = planStory([child(1, { labels: ["conductor-blocked"] }), child(2)], label);
    expect(plan.action).toBe("blocked");
    expect(plan.statuses).toEqual(["blocked", "queued"]);
  });
});

describe("story text", () => {
  it("describes a child per status", () => {
    expect(describeChild(child(4, { openPrs: [8, 9] }), "in-review")).toBe("#4 in review (PR #8, #9): T4");
    expect(describeChild(child(5), "queued")).toBe("#5 queued: T5");
  });

  it("summarises the story, then lists the children", () => {
    const children = [child(1, { labels: ["automata"] })];
    const lines = storyLines(planStory(children, label), children);
    expect(lines[0]).toMatch(/child #1 is waiting: do-work has not opened a pull request yet/);
    expect(lines[1]).toBe("  #1 started, waiting for a pull request: T1");
  });

  it("names the children in the closing comment", () => {
    expect(storyDoneComment([child(1), child(2)])).toMatch(/All 2 child issues are closed[\s\S]*- #2 T2/);
  });
});
