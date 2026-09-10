import { describe, it, expect } from "vitest";
import {
  describeExecution,
  describeInvalidTool,
  parseRunDirective,
  resolveExecution,
  triggeringMessage,
  VALID_TOOLS,
  type ResolveExecutionInput,
} from "../../src/github/runDirective.js";
import {
  analyzeSurface,
  type Participants,
  type RawMessage,
} from "../../src/github/conversation.js";
import type { ReviewThread } from "../../src/github/ghWorkService.js";
import type { WorkItem } from "../../src/github/workDetection.js";

const PARTICIPANTS: Participants = { allowedUsers: ["alice", "bob"], agentUser: "automata-bot" };

function message(
  author: string,
  createdAt: string,
  body: string,
  kind: RawMessage["kind"] = "issue-comment",
): RawMessage {
  return { kind, author, body, createdAt };
}

/* ── parseRunDirective ──────────────────────────────────────────────────── */

describe("parseRunDirective", () => {
  it.each([
    ["tool:codex", "codex", undefined],
    ["TOOL:CODEX", "codex", undefined],
    ["Tool:Claude", "claude", undefined],
    ["use tool:codex please", "codex", undefined],
    ["tool:claude and later tool:codex", "codex", undefined],
    ["model:GPT-5-Codex", undefined, "GPT-5-Codex"],
    ["tool:codex model:o3", "codex", "o3"],
    ["model:a then model:b", undefined, "b"],
    ["tool:codexx", "codexx", undefined],
    ["", undefined, undefined],
    ["no directive here", undefined, undefined],
  ])("reads %j", (body, tool, model) => {
    expect(parseRunDirective(body)).toEqual({ tool, model });
  });

  it.each(["mytool:codex", "no-tool:codex", "x:tool:codex", "1tool:codex", "_tool:codex"])(
    "does not treat %j as a directive",
    (body) => {
      expect(parseRunDirective(body).tool).toBeUndefined();
    },
  );

  it.each(["mymodel:o3", "no-model:o3", "x:model:o3"])(
    "does not treat %j as a directive",
    (body) => {
      expect(parseRunDirective(body).model).toBeUndefined();
    },
  );

  it("requires the value to follow the colon directly", () => {
    expect(parseRunDirective("tool: codex").tool).toBeUndefined();
    expect(parseRunDirective("tool:").tool).toBeUndefined();
  });

  it("preserves the model's case but lower-cases the tool", () => {
    expect(parseRunDirective("TOOL:CoDeX MODEL:Claude-Opus-4-6")).toEqual({
      tool: "codex",
      model: "Claude-Opus-4-6",
    });
  });

  it("accepts vendor-prefixed and dated model identifiers", () => {
    expect(parseRunDirective("model:anthropic/claude-sonnet-4-5-20250929").model).toBe(
      "anthropic/claude-sonnet-4-5-20250929",
    );
    expect(parseRunDirective("model:gpt-5+high").model).toBe("gpt-5+high");
  });

  it("stops at surrounding punctuation and markdown", () => {
    expect(parseRunDirective("please use `tool:codex`, thanks.").tool).toBe("codex");
    expect(parseRunDirective("(model:o3)").model).toBe("o3");
  });

  it("is not confused by repeated parsing of the same body", () => {
    // Guards against a shared global RegExp carrying lastIndex between calls.
    const body = "tool:codex model:o3";
    expect(parseRunDirective(body)).toEqual(parseRunDirective(body));
  });
});

/* ── resolveExecution ───────────────────────────────────────────────────── */

function input(overrides: Partial<ResolveExecutionInput> = {}): ResolveExecutionInput {
  return {
    directive: { tool: undefined, model: undefined },
    defaultExecutor: "claude",
    ...overrides,
  };
}

describe("resolveExecution — the executor", () => {
  it("falls back to the built-in default", () => {
    expect(resolveExecution(input())).toMatchObject({
      ok: true,
      executor: "claude",
      executorSource: "default",
    });
  });

  it("takes doWork.executor over the default", () => {
    expect(resolveExecution(input({ configExecutor: "codex" }))).toMatchObject({
      executor: "codex",
      executorSource: "config",
    });
  });

  it("takes --with over doWork.executor", () => {
    expect(
      resolveExecution(input({ withOption: "claude", configExecutor: "codex" })),
    ).toMatchObject({
      executor: "claude",
      executorSource: "option",
    });
  });

  it("takes the message directive over --with", () => {
    expect(
      resolveExecution(
        input({ directive: { tool: "codex", model: undefined }, withOption: "claude" }),
      ),
    ).toMatchObject({ executor: "codex", executorSource: "message" });
  });

  it("refuses a tool value that is not an executor", () => {
    expect(resolveExecution(input({ directive: { tool: "codexx", model: undefined } }))).toEqual({
      ok: false,
      invalidTool: "codexx",
    });
  });

  it("refuses without computing anything else", () => {
    const result = resolveExecution(
      input({ directive: { tool: "gemini", model: "whatever" }, configExecutor: "codex" }),
    );
    expect(result).toEqual({ ok: false, invalidTool: "gemini" });
  });
});

describe("resolveExecution — the model", () => {
  it("is undefined when nothing supplies one", () => {
    expect(resolveExecution(input())).toMatchObject({ model: undefined, modelSource: "none" });
  });

  it("takes doWork.models for the effective executor", () => {
    expect(
      resolveExecution(
        input({ configExecutor: "codex", configModels: { claude: "opus", codex: "o3" } }),
      ),
    ).toMatchObject({ executor: "codex", model: "o3", modelSource: "config" });
  });

  it("takes --model over doWork.models", () => {
    expect(
      resolveExecution(input({ modelOption: "flag-model", configModels: { claude: "opus" } })),
    ).toMatchObject({ model: "flag-model", modelSource: "option" });
  });

  it("takes the message directive over --model", () => {
    expect(
      resolveExecution(
        input({ directive: { tool: undefined, model: "msg" }, modelOption: "flag" }),
      ),
    ).toMatchObject({ model: "msg", modelSource: "message" });
  });

  it("uses the new executor's configured default when tool: switches executor", () => {
    expect(
      resolveExecution(
        input({
          directive: { tool: "codex", model: undefined },
          configExecutor: "claude",
          configModels: { claude: "claude-opus-4-6", codex: "o3" },
        }),
      ),
    ).toMatchObject({ executor: "codex", model: "o3", modelSource: "config" });
  });

  it("drops --model when tool: switches executor", () => {
    // A Claude identifier is not a valid Codex model; carrying the operator's
    // flag across the switch would send nonsense to Codex.
    expect(
      resolveExecution(
        input({
          directive: { tool: "codex", model: undefined },
          modelOption: "claude-opus-4-6",
          configExecutor: "claude",
        }),
      ),
    ).toMatchObject({ executor: "codex", model: undefined, modelSource: "none" });
  });

  it("keeps --model when tool: names the executor that was going to run anyway", () => {
    expect(
      resolveExecution(
        input({
          directive: { tool: "claude", model: undefined },
          modelOption: "claude-opus-4-6",
          configExecutor: "claude",
        }),
      ),
    ).toMatchObject({ executor: "claude", model: "claude-opus-4-6", modelSource: "option" });
  });

  it("honours an explicit model: even when tool: switches executor", () => {
    expect(
      resolveExecution(
        input({
          directive: { tool: "codex", model: "gpt-5-codex" },
          modelOption: "claude-opus-4-6",
          configModels: { codex: "o3" },
        }),
      ),
    ).toMatchObject({ executor: "codex", model: "gpt-5-codex", modelSource: "message" });
  });

  it("respects a non-default defaultExecutor when deciding whether tool: switched", () => {
    expect(
      resolveExecution(
        input({
          directive: { tool: "codex", model: undefined },
          defaultExecutor: "codex",
          modelOption: "o3",
        }),
      ),
    ).toMatchObject({ executor: "codex", model: "o3", modelSource: "option" });
  });
});

/* ── resolveExecution — the reasoning effort ────────────────────────────── */

describe("resolveExecution — the effort", () => {
  it("is absent when neither the flag nor the config names one", () => {
    expect(resolveExecution(input())).toMatchObject({ effort: undefined, effortSource: "none" });
  });

  it("takes the configured default for the executor in use", () => {
    expect(
      resolveExecution(
        input({ configExecutor: "codex", configEfforts: { claude: "high", codex: "medium" } }),
      ),
    ).toMatchObject({ executor: "codex", effort: "medium", effortSource: "config" });
  });

  it("lets --effort override the configured default", () => {
    expect(
      resolveExecution(input({ effortOption: "max", configEfforts: { claude: "high" } })),
    ).toMatchObject({ effort: "max", effortSource: "option" });
  });

  it("trims a configured level so padding cannot reach the executor", () => {
    // Neither executor errors on an unknown level, so `" high "` would be
    // silently ignored rather than reported.
    expect(resolveExecution(input({ configEfforts: { claude: "  high  " } }))).toMatchObject({
      effort: "high",
      effortSource: "config",
    });
  });

  it("treats a whitespace-only configured level as absent", () => {
    expect(resolveExecution(input({ configEfforts: { claude: "   " } }))).toMatchObject({
      effort: undefined,
      effortSource: "none",
    });
  });

  it("uses the new executor's configured level when tool: switches executor", () => {
    // The two CLIs accept different level names, so the level must follow the
    // executor exactly the way the model does.
    expect(
      resolveExecution(
        input({
          directive: { tool: "codex", model: undefined },
          configExecutor: "claude",
          configEfforts: { claude: "max", codex: "medium" },
        }),
      ),
    ).toMatchObject({ executor: "codex", effort: "medium", effortSource: "config" });
  });

  it("drops --effort when tool: switches executor", () => {
    // `max` is a Claude level codex does not accept; carrying the operator's
    // flag across the switch would forward it to the API unchallenged.
    expect(
      resolveExecution(
        input({
          directive: { tool: "codex", model: undefined },
          effortOption: "max",
          configExecutor: "claude",
        }),
      ),
    ).toMatchObject({ executor: "codex", effort: undefined, effortSource: "none" });
  });

  it("keeps --effort when tool: names the executor that was going to run anyway", () => {
    expect(
      resolveExecution(
        input({
          directive: { tool: "claude", model: undefined },
          effortOption: "max",
          configExecutor: "claude",
        }),
      ),
    ).toMatchObject({ executor: "claude", effort: "max", effortSource: "option" });
  });

  it("is unaffected by a model: directive, which says nothing about the effort", () => {
    expect(
      resolveExecution(
        input({ directive: { tool: undefined, model: "opus" }, configEfforts: { claude: "high" } }),
      ),
    ).toMatchObject({ model: "opus", modelSource: "message", effort: "high", effortSource: "config" });
  });

  it("is not resolved at all when the tool: value is invalid", () => {
    expect(
      resolveExecution(
        input({ directive: { tool: "codexx", model: undefined }, configEfforts: { claude: "high" } }),
      ),
    ).toEqual({ ok: false, invalidTool: "codexx" });
  });
});

/* ── triggeringMessage ──────────────────────────────────────────────────── */

function workItem(overrides: Partial<WorkItem>): WorkItem {
  return {
    issue: { number: 1, title: "t", body: "b", url: "u" },
    turn: "issue-discuss",
    pr: null,
    branch: "develop",
    needsAssignment: false,
    issueAnalysis: analyzeSurface([], PARTICIPANTS),
    prAnalysis: null,
    actionableThreads: [],
    reason: "because",
    ambiguousPrs: [],
    ...overrides,
  };
}

function thread(comments: RawMessage[]): ReviewThread {
  return { path: "a.ts", line: 1, isResolved: false, comments, url: null };
}

describe("triggeringMessage", () => {
  it("returns null when nothing is new", () => {
    expect(triggeringMessage(workItem({}))).toBeNull();
  });

  it("picks the newest new issue message on a discuss turn", () => {
    const item = workItem({
      issueAnalysis: analyzeSurface(
        [
          message("alice", "2026-01-01T00:00:00Z", "tool:codex"),
          message("bob", "2026-01-02T00:00:00Z", "tool:claude"),
        ],
        PARTICIPANTS,
      ),
    });
    expect(triggeringMessage(item)?.body).toBe("tool:claude");
  });

  it("ignores messages the agent has already answered", () => {
    const item = workItem({
      issueAnalysis: analyzeSurface(
        [
          message("alice", "2026-01-01T00:00:00Z", "tool:codex"),
          message("automata-bot", "2026-01-02T00:00:00Z", "answered"),
          message("alice", "2026-01-03T00:00:00Z", "no directive"),
        ],
        PARTICIPANTS,
      ),
    });
    expect(triggeringMessage(item)?.body).toBe("no directive");
  });

  it("reads the issue description on the first turn", () => {
    const item = workItem({
      issueAnalysis: analyzeSurface(
        [message("alice", "2026-01-01T00:00:00Z", "tool:codex", "issue-body")],
        PARTICIPANTS,
      ),
    });
    expect(triggeringMessage(item)?.body).toBe("tool:codex");
  });

  it("picks the newest across issue and pull request on a build turn", () => {
    const item = workItem({
      turn: "pr-work",
      issueAnalysis: analyzeSurface(
        [message("alice", "2026-01-03T00:00:00Z", "issue newest")],
        PARTICIPANTS,
      ),
      prAnalysis: analyzeSurface(
        [message("bob", "2026-01-02T00:00:00Z", "pr older", "pr-comment")],
        PARTICIPANTS,
      ),
    });
    expect(triggeringMessage(item)?.body).toBe("issue newest");
  });

  it("picks an unresolved review-thread comment when it is the newest", () => {
    const item = workItem({
      turn: "pr-work",
      issueAnalysis: analyzeSurface([], PARTICIPANTS),
      prAnalysis: analyzeSurface(
        [message("automata-bot", "2026-01-01T00:00:00Z", "agent", "pr-comment")],
        PARTICIPANTS,
      ),
      actionableThreads: [
        thread([message("alice", "2026-01-05T00:00:00Z", "tool:codex", "thread-comment")]),
      ],
    });
    expect(triggeringMessage(item)?.body).toBe("tool:codex");
  });

  it("ignores thread comments the agent has already answered on the pull request", () => {
    const item = workItem({
      turn: "pr-work",
      prAnalysis: analyzeSurface(
        [
          message("alice", "2026-01-05T00:00:00Z", "pr newest", "pr-comment"),
          message("automata-bot", "2026-01-04T00:00:00Z", "agent", "pr-comment"),
        ],
        PARTICIPANTS,
      ),
      actionableThreads: [
        thread([message("alice", "2026-01-02T00:00:00Z", "stale thread", "thread-comment")]),
      ],
    });
    expect(triggeringMessage(item)?.body).toBe("pr newest");
  });

  it("does not mutate the item", () => {
    const item = workItem({
      issueAnalysis: analyzeSurface([message("alice", "2026-01-01T00:00:00Z", "x")], PARTICIPANTS),
    });
    const before = JSON.stringify(item);
    triggeringMessage(item);
    expect(JSON.stringify(item)).toBe(before);
  });
});

/* ── rendering ──────────────────────────────────────────────────────────── */

describe("describeExecution", () => {
  it("names the model when there is one", () => {
    expect(
      describeExecution({
        executor: "codex",
        executorSource: "config",
        model: "o3",
        modelSource: "config",
        effort: undefined,
        effortSource: "none",
      }),
    ).toBe("codex · model o3");
  });

  it("says so when there is no model override", () => {
    expect(
      describeExecution({
        executor: "claude",
        executorSource: "default",
        model: undefined,
        modelSource: "none",
        effort: undefined,
        effortSource: "none",
      }),
    ).toBe("claude (no model override)");
  });

  it("credits the message when the executor came from it", () => {
    expect(
      describeExecution({
        executor: "codex",
        executorSource: "message",
        model: undefined,
        modelSource: "none",
        effort: undefined,
        effortSource: "none",
      }),
    ).toBe("codex (no model override) — from the message");
  });

  it("credits the message when only the model came from it", () => {
    expect(
      describeExecution({
        executor: "claude",
        executorSource: "default",
        model: "opus",
        modelSource: "message",
        effort: undefined,
        effortSource: "none",
      }),
    ).toBe("claude · model opus — from the message");
  });

  it("names the effort after the model when there is one", () => {
    expect(
      describeExecution({
        executor: "codex",
        executorSource: "config",
        model: "o3",
        modelSource: "config",
        effort: "medium",
        effortSource: "config",
      }),
    ).toBe("codex · model o3 · effort medium");
  });

  it("keeps the message credit last, after the effort", () => {
    // The credit is about the executor and the model; no directive can name an
    // effort, so it must not read as if one did.
    expect(
      describeExecution({
        executor: "codex",
        executorSource: "message",
        model: undefined,
        modelSource: "none",
        effort: "medium",
        effortSource: "config",
      }),
    ).toBe("codex (no model override) · effort medium — from the message");
  });
});

describe("describeInvalidTool", () => {
  it("quotes the value back and lists the valid ones", () => {
    const text = describeInvalidTool("codexx");
    expect(text).toContain("`tool:codexx`");
    for (const tool of VALID_TOOLS) expect(text).toContain(`\`${tool}\``);
  });
});
