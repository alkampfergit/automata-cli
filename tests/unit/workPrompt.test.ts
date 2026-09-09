import { describe, it, expect } from "vitest";
import { composePrompt } from "../../src/github/workPrompt.js";
import { analyzeSurface, type Participants, type RawMessage } from "../../src/github/conversation.js";
import type { WorkItem } from "../../src/github/workDetection.js";
import type { PullRequestRef, ReviewThread } from "../../src/github/ghWorkService.js";
import {
  DEFAULT_DO_WORK_ISSUE_DISCUSS_PROMPT,
  DEFAULT_DO_WORK_PR_WORK_PROMPT,
} from "../../src/config/configStore.js";

const P: Participants = { allowedUsers: ["alice"], agentUser: "automata-bot" };
const REPO = { owner: "acme", repo: "widget" };
const ISSUE = { number: 42, title: "Add a flag", body: "please add it", url: "https://gh/i/42" };

function message(author: string, createdAt: string, body: string, kind: RawMessage["kind"] = "issue-comment"): RawMessage {
  return { kind, author, body, createdAt };
}

const PR: PullRequestRef = {
  number: 57,
  url: "https://gh/pr/57",
  title: "Add a flag",
  headRefName: "feature/042-flag",
  state: "OPEN",
  isDraft: false,
  updatedAt: "2026-01-05T00:00:00Z",
};

function discussItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    issue: ISSUE,
    turn: "issue-discuss",
    pr: null,
    branch: "develop",
    needsAssignment: true,
    issueAnalysis: analyzeSurface(
      [
        message("alice", "2026-01-01T00:00:00Z", "please add it", "issue-body"),
        message("nosy-stranger", "2026-01-02T00:00:00Z", "secret third-party text"),
      ],
      P,
    ),
    prAnalysis: null,
    actionableThreads: [],
    reason: "1 new issue message, no open pull request",
    ambiguousPrs: [],
    ...overrides,
  };
}

const THREAD: ReviewThread = {
  path: "src/index.ts",
  line: 12,
  isResolved: false,
  comments: [message("alice", "2026-01-06T00:00:00Z", "rename this variable", "thread-comment")],
};

function prItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    ...discussItem(),
    turn: "pr-work",
    pr: PR,
    branch: PR.headRefName,
    prAnalysis: analyzeSurface([message("alice", "2026-01-07T00:00:00Z", "please also rename it", "pr-comment")], P),
    actionableThreads: [THREAD],
    reason: "1 unresolved review thread",
    ...overrides,
  };
}

function compose(item: WorkItem, frame = "FRAME TEXT"): string {
  return composePrompt({ item, repo: REPO, agentUser: "automata-bot", baseBranch: "develop", frame });
}

describe("composePrompt — the frame", () => {
  it("places the configured frame first and verbatim", () => {
    const prompt = compose(discussItem(), "Use the `my-skill` skill.\nBe brief.");
    expect(prompt.startsWith("Use the `my-skill` skill.\nBe brief.")).toBe(true);
  });

  it("appends the context after the frame", () => {
    const prompt = compose(discussItem());
    expect(prompt.indexOf("FRAME TEXT")).toBeLessThan(prompt.indexOf("--- Context assembled by automata ---"));
  });
});

describe("composePrompt — context", () => {
  it.each([
    ["the repository", "Repository: acme/widget"],
    ["the agent identity", "You are: automata-bot"],
    ["the turn kind", "Turn: issue-discuss"],
    ["the base branch", "Base branch: develop"],
    ["the issue number and title", "Issue #42: Add a flag"],
    ["the issue URL", "Issue URL: https://gh/i/42"],
  ])("includes %s", (_what, expected) => {
    expect(compose(discussItem())).toContain(expected);
  });

  it.each([
    ["pull request identity", "Pull request #"],
    ["a branch line", "Branch: feature/042-flag"],
  ])("omits %s on a discuss turn", (_what, absent) => {
    expect(compose(discussItem())).not.toContain(absent);
  });

  it("includes the pull request number, URL and branch on a build turn", () => {
    const prompt = compose(prItem());
    expect(prompt).toContain("Turn: pr-work");
    expect(prompt).toContain("Pull request #57: Add a flag");
    expect(prompt).toContain("Pull request URL: https://gh/pr/57");
    expect(prompt).toContain("Branch: feature/042-flag (checked out and up to date)");
  });

  it("renders the new messages under their own heading", () => {
    const prompt = compose(discussItem());
    expect(prompt).toContain("New since your last message — this is what you must answer:");
    expect(prompt).toContain("NEW since last agent run");
  });

  it("renders the full issue conversation", () => {
    const prompt = compose(discussItem());
    expect(prompt).toContain("Full conversation on the issue");
    expect(prompt).toContain("please add it");
  });

  it("renders the pull request conversation on a build turn", () => {
    const prompt = compose(prItem());
    expect(prompt).toContain("Conversation on the pull request");
    expect(prompt).toContain("please also rename it");
  });

  it("renders unresolved threads with their file and line", () => {
    const prompt = compose(prItem());
    expect(prompt).toContain("Unresolved review threads needing an answer:");
    expect(prompt).toContain("[alice] src/index.ts:12");
    expect(prompt).toContain("rename this variable");
  });

  it("renders a file-level thread without a line number", () => {
    const prompt = compose(prItem({ actionableThreads: [{ ...THREAD, line: null }] }));
    expect(prompt).toContain("src/index.ts:(file)");
  });

  it("never leaks content from unauthorized accounts", () => {
    const prompt = compose(prItem());
    expect(prompt).not.toContain("nosy-stranger");
    expect(prompt).not.toContain("secret third-party text");
  });

  it("states that other accounts' messages were withheld", () => {
    expect(compose(discussItem())).toContain("Anything from other accounts has been withheld");
  });

  it("reports the other pull requests when the link is ambiguous", () => {
    const prompt = compose(prItem({ ambiguousPrs: [{ ...PR, number: 58 }] }));
    expect(prompt).toContain("also closed by #58");
    expect(prompt).toContain("You are working on #57");
  });

  it("omits the new-message section when nothing is new", () => {
    const prompt = compose(
      discussItem({
        issueAnalysis: analyzeSurface(
          [
            message("alice", "2026-01-01T00:00:00Z", "please add it", "issue-body"),
            message("automata-bot", "2026-01-02T00:00:00Z", "on it"),
          ],
          P,
        ),
      }),
    );
    expect(prompt).not.toContain("New since your last message");
  });
});

describe("the shipped default frames", () => {
  it("carry the discuss turn boundary", () => {
    const prompt = compose(discussItem(), DEFAULT_DO_WORK_ISSUE_DISCUSS_PROMPT);
    expect(prompt).toContain("Do not modify, create or delete any file");
    expect(prompt).toContain("UNLESS a message marked NEW explicitly asks you to implement");
    expect(prompt).toContain("Closes #");
  });

  it("carry the build turn boundary", () => {
    const prompt = compose(prItem(), DEFAULT_DO_WORK_PR_WORK_PROMPT);
    expect(prompt).toContain("Do not merge the pull request");
    expect(prompt).toContain("do not push to the base branch");
  });

  it("name no skill, so do-work works with nothing installed", () => {
    expect(DEFAULT_DO_WORK_ISSUE_DISCUSS_PROMPT).not.toMatch(/skill/i);
    expect(DEFAULT_DO_WORK_PR_WORK_PROMPT).not.toMatch(/skill/i);
  });
});
