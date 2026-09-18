import { describe, it, expect } from "vitest";
import {
  assembleReport,
  describeDuration,
  gitSection,
  lockSection,
  renderText,
  tickCadence,
  tickSection,
  toJson,
  workSection,
  MIN_INTERVALS,
  SECTION_ORDER,
  SILENCE_MULTIPLIER,
  type CheckSection,
} from "../../src/run/checkReport.js";
import type { ExecutionTick, LogReadResult, WorkRecord } from "../../src/run/operationLog.js";
import type { LockStatus } from "../../src/run/runLock.js";
import type { RepoStatus } from "../../src/git/repoStatus.js";

const NOW = new Date("2026-01-10T12:00:00.000Z");
const MINUTE = 60 * 1000;

function owner(
  overrides: Partial<{ pid: number; startedAt: string; host: string; command: string }> = {},
) {
  return {
    pid: 1234,
    startedAt: new Date(NOW.getTime() - 5 * MINUTE).toISOString(),
    host: "build-01",
    command: "do-work",
    token: "t",
    ...overrides,
  };
}

function tick(overrides: Partial<ExecutionTick> = {}): ExecutionTick {
  return {
    timestamp: NOW,
    command: "do-work",
    repo: "acme/widgets",
    items: 0,
    counts: { answered: 0, "answered-no-reply": 0, skipped: 0, failed: 0, deferred: 0 },
    runs: 0,
    exitCode: 0,
    durationSeconds: 1,
    note: null,
    ...overrides,
  };
}

function ticksEvery(
  intervalMs: number,
  count: number,
  sinceNewestMs = intervalMs,
): ExecutionTick[] {
  const newest = NOW.getTime() - sinceNewestMs;
  return Array.from({ length: count }, (_, index) =>
    tick({ timestamp: new Date(newest - index * intervalMs) }),
  );
}

function read<T>(entries: T[], overrides: Partial<LogReadResult<T>> = {}): LogReadResult<T> {
  return {
    entries,
    present: true,
    error: null,
    skipped: 0,
    otherRepos: 0,
    path: "/workspace/automata-execution.log",
    ...overrides,
  };
}

function repoStatus(overrides: Partial<RepoStatus> = {}): RepoStatus {
  return {
    branch: "develop",
    head: "abc1234",
    dirtyPaths: [],
    statusError: null,
    baseBranch: "develop",
    baseLocal: true,
    upstream: "origin/develop",
    upstreamTracked: true,
    ahead: 0,
    behind: 0,
    refreshed: true,
    fetchError: null,
    error: null,
    ...overrides,
  };
}

describe("tickCadence", () => {
  it("reports no cadence for an empty history", () => {
    expect(tickCadence([], NOW)).toEqual({
      medianIntervalMs: null,
      sinceNewestMs: null,
      silent: false,
    });
  });

  it("withholds judgement until three intervals exist", () => {
    // Three ticks give two intervals — one delayed tick would distort a median
    // of two, and a day-old installation must not report a failure.
    const cadence = tickCadence(ticksEvery(5 * MINUTE, MIN_INTERVALS, 10 * 60 * MINUTE), NOW);
    expect(cadence.medianIntervalMs).toBeNull();
    expect(cadence.silent).toBe(false);
    expect(cadence.sinceNewestMs).toBe(10 * 60 * MINUTE);
  });

  it("takes the median of the intervals, not the mean", () => {
    // Intervals of 5m, 5m, 5m and one 10-hour outage: the mean would be over
    // two hours, the median stays at five minutes.
    const base = NOW.getTime() - 5 * MINUTE;
    const stamps = [0, 5, 10, 15, 15 + 600].map((offset) => base - offset * MINUTE);
    const cadence = tickCadence(
      stamps.map((stamp) => tick({ timestamp: new Date(stamp) })),
      NOW,
    );
    expect(cadence.medianIntervalMs).toBe(5 * MINUTE);
  });

  it("is quiet just inside the silence threshold and loud just outside it", () => {
    const interval = 5 * MINUTE;
    const quiet = tickCadence(ticksEvery(interval, 10, SILENCE_MULTIPLIER * interval), NOW);
    expect(quiet.silent).toBe(false);

    const loud = tickCadence(ticksEvery(interval, 10, SILENCE_MULTIPLIER * interval + 1), NOW);
    expect(loud.silent).toBe(true);
  });

  it("ignores a non-positive gap between two ticks sharing a timestamp", () => {
    const stamp = NOW.getTime() - 5 * MINUTE;
    const cadence = tickCadence(
      [stamp, stamp, stamp, stamp].map((value) => tick({ timestamp: new Date(value) })),
      NOW,
    );
    expect(cadence.medianIntervalMs).toBeNull();
  });
});

describe("lockSection", () => {
  it("does not treat a live tick as a problem", () => {
    const status: LockStatus = { kind: "held", owner: owner(), heldForMs: 5 * MINUTE };
    const section = lockSection(status, 120);
    expect(section.problems).toEqual([]);
    expect(section.lines[0]).toContain("a tick is running");
    expect(section.lines[0]).toContain("pid 1234 on build-01");
  });

  it("reports a free lock with no problem", () => {
    expect(lockSection({ kind: "free" }, 120).problems).toEqual([]);
  });

  it("flags a suspect lock and names the staleness window", () => {
    const section = lockSection(
      { kind: "suspect", owner: owner(), heldForMs: 3 * 60 * MINUTE },
      120,
    );
    expect(section.problems).toHaveLength(1);
    expect(section.problems[0].section).toBe("lock");
    expect(section.problems[0].summary).toContain("120 minutes");
  });

  it("flags a stale lock but says it heals itself", () => {
    const section = lockSection({ kind: "stale", owner: owner(), heldForMs: null }, 120);
    expect(section.problems).toHaveLength(1);
    expect(section.problems[0].summary).toContain("the next tick reclaims it");
  });

  it("flags an unreadable lock, distinctly from a stale one", () => {
    const section = lockSection({ kind: "unreadable", detail: "EACCES" }, 120);
    expect(section.problems[0].summary).toContain("EACCES");
    expect(section.data.status).toBe("unreadable");
  });
});

describe("tickSection", () => {
  it("reports the newest tick's counts, exit code and age", () => {
    const section = tickSection(
      read([
        tick({
          timestamp: new Date(NOW.getTime() - 4 * MINUTE),
          items: 2,
          counts: { answered: 1, "answered-no-reply": 0, skipped: 1, failed: 0, deferred: 0 },
          runs: 1,
        }),
      ]),
      NOW,
    );
    expect(section.lines[0]).toContain("answered=1");
    expect(section.lines[0]).toContain("skipped=1");
    expect(section.lines[0]).toContain("exit=0");
    expect(section.lines[0]).toContain("(4m ago)");
    expect(section.problems).toEqual([]);
  });

  it("flags a missing execution log", () => {
    const section = tickSection(read<ExecutionTick>([], { present: false }), NOW);
    expect(section.problems).toHaveLength(1);
    expect(section.problems[0].summary).toContain("no execution log");
  });

  it("flags an unreadable execution log distinctly from a missing one", () => {
    const section = tickSection(read<ExecutionTick>([], { present: false, error: "EACCES" }), NOW);
    expect(section.problems[0].summary).toContain("EACCES");
  });

  it("flags a log that holds no tick for this repository", () => {
    const section = tickSection(read<ExecutionTick>([]), NOW);
    expect(section.problems[0].summary).toContain("never successfully run");
  });

  it("flags a non-zero exit on the newest tick", () => {
    const section = tickSection(read([tick({ exitCode: 2 })]), NOW);
    expect(section.problems.some((problem) => problem.summary.includes("exited 2"))).toBe(true);
  });

  it("flags scheduler silence with both the observed and the usual interval", () => {
    const section = tickSection(read(ticksEvery(5 * MINUTE, 10, 4 * 60 * MINUTE)), NOW);
    const silence = section.problems.find((problem) => problem.summary.includes("stopped firing"));
    expect(silence).toBeDefined();
    expect(silence?.summary).toContain("4h 0m");
    expect(silence?.summary).toContain("5m");
  });

  it("does not flag an idle loop that is still firing on schedule", () => {
    const section = tickSection(read(ticksEvery(5 * MINUTE, 10)), NOW);
    expect(section.problems).toEqual([]);
    expect(section.lines.some((line) => line.includes("about one tick every 5m"))).toBe(true);
  });

  it("flags a loop where every recorded tick was turned away by the lock", () => {
    const section = tickSection(
      read(ticksEvery(5 * MINUTE, 6).map((entry) => ({ ...entry, note: "lock-held" }))),
      NOW,
    );
    expect(section.problems.some((problem) => problem.summary.includes("wedged"))).toBe(true);
    expect(section.data.lockHeldCount).toBe(6);
  });

  it("mentions unparseable lines and other repositories without calling them problems", () => {
    const section = tickSection(
      read(ticksEvery(5 * MINUTE, 5), { skipped: 2, otherRepos: 7 }),
      NOW,
    );
    expect(section.lines.some((line) => line.includes("2 log line(s) could not be parsed"))).toBe(
      true,
    );
    expect(
      section.lines.some((line) => line.includes("7 line(s) belonged to another repository")),
    ).toBe(true);
    expect(section.problems).toEqual([]);
  });
});

describe("workSection", () => {
  const record: WorkRecord = {
    timestamp: new Date(NOW.getTime() - 30 * MINUTE),
    repo: "acme/widgets",
    items: [
      {
        subject: "#42",
        turn: "issue-discuss",
        outcome: "answered",
        executor: "claude",
        model: "opus",
        effort: "high",
        sync: null,
        detail: "posted an answer",
      },
    ],
  };

  it("prints each item with its executor and detail", () => {
    const section = workSection(read([record]), NOW);
    expect(section.lines[0]).toContain("(30m ago)");
    expect(section.lines[1]).toBe(
      "  #42 issue-discuss answered [claude opus high] — posted an answer",
    );
  });

  it("names the synchronisation strategy when one was recorded", () => {
    const rebased = { ...record, items: [{ ...record.items[0], sync: "rebase" }] };
    expect(workSection(read([rebased]), NOW).lines[1]).toBe(
      "  #42 issue-discuss answered [claude opus high] sync=rebase — posted an answer",
    );
  });

  it("omits the executor bracket when none was recorded", () => {
    const bare = {
      ...record,
      items: [{ ...record.items[0], executor: null, model: null, effort: null }],
    };
    expect(workSection(read([bare]), NOW).lines[1]).toBe(
      "  #42 issue-discuss answered — posted an answer",
    );
  });

  it("does not treat an empty work log as a problem", () => {
    // A loop with nothing to answer legitimately invokes no executor for days;
    // the ticks section is what notices a loop that has stopped.
    const section = workSection(read<WorkRecord>([], { present: false }), NOW);
    expect(section.problems).toEqual([]);
    expect(section.lines[0]).toContain("no tick has invoked the executor");
  });

  it("flags a work log that exists but cannot be read", () => {
    const section = workSection(read<WorkRecord>([], { present: false, error: "EACCES" }), NOW);
    expect(section.problems).toHaveLength(1);
  });
});

describe("gitSection", () => {
  it("reports a clean, level checkout with no problem", () => {
    const section = gitSection(repoStatus());
    expect(section.problems).toEqual([]);
    expect(section.lines).toContain("working tree is clean");
    expect(section.lines.some((line) => line.includes("ahead 0, behind 0"))).toBe(true);
  });

  it("flags a dirty tree and names the paths", () => {
    const section = gitSection(repoStatus({ dirtyPaths: [" M src/a.ts", "?? b.txt"] }));
    expect(section.problems).toHaveLength(1);
    expect(section.problems[0].summary).toContain("dirty-tree");
    expect(section.lines).toContain("   M src/a.ts");
  });

  it("flags a detached HEAD", () => {
    const section = gitSection(repoStatus({ branch: null }));
    expect(section.problems[0].summary).toContain("HEAD is detached");
  });

  it("does not flag being on a branch other than the base", () => {
    // The pre-flight checks the base branch out itself, so this is the normal
    // state between ticks.
    expect(gitSection(repoStatus({ branch: "feature/036" })).problems).toEqual([]);
  });

  it("flags a diverged base branch and explains what it breaks", () => {
    const section = gitSection(repoStatus({ ahead: 2, behind: 3 }));
    expect(section.problems).toHaveLength(1);
    expect(section.problems[0].summary).toContain("fast-forward pull");
  });

  it("does not flag a base branch that is only ahead", () => {
    const section = gitSection(repoStatus({ ahead: 2, behind: 0 }));
    expect(section.problems).toEqual([]);
    expect(
      section.lines.some((line) => line.includes("2 local commit(s) not on origin/develop")),
    ).toBe(true);
  });

  it("does not flag a base branch that is only behind", () => {
    // The pre-flight fast-forwards it; that is what it is for.
    expect(gitSection(repoStatus({ ahead: 0, behind: 9 })).problems).toEqual([]);
  });

  it("flags a missing base branch and names the config key that sets it", () => {
    const section = gitSection(repoStatus({ baseLocal: false }));
    expect(section.problems[0].summary).toContain("do-work-base-branch");
  });

  it("flags a base branch with no upstream", () => {
    const section = gitSection(repoStatus({ upstream: null, upstreamTracked: false }));
    expect(section.problems[0].summary).toContain("no upstream");
  });

  it("flags a base branch whose upstream was only inferred from the remote-tracking ref", () => {
    // `prepareBaseBranch` runs a bare `git pull --ff-only`, which reads the
    // branch's tracking configuration. Showing `origin/develop` as the upstream
    // without saying it was inferred promises a fast-forward that cannot happen.
    const section = gitSection(repoStatus({ upstreamTracked: false }));
    expect(section.problems).toHaveLength(1);
    expect(section.problems[0].summary).toContain("git branch --set-upstream-to=origin/develop");
    expect(section.lines.some((line) => line.includes("no tracking configuration"))).toBe(true);
  });

  it("flags a working tree that could not be inspected instead of calling it clean", () => {
    const section = gitSection(repoStatus({ statusError: "fatal: unable to read index" }));
    expect(section.problems).toHaveLength(1);
    expect(section.problems[0].summary).toContain("unable to read index");
    expect(section.lines).not.toContain("working tree is clean");
  });

  it("flags a divergence that could not be read rather than exiting healthy", () => {
    const section = gitSection(repoStatus({ ahead: null, behind: null }));
    expect(section.problems).toHaveLength(1);
    expect(section.problems[0].summary).toContain("could not be read");
    expect(section.lines.some((line) => line.includes("ahead ?, behind ?"))).toBe(true);
  });

  it("labels unrefreshed figures and flags a failed fetch", () => {
    const section = gitSection(repoStatus({ refreshed: false, fetchError: "no route to host" }));
    expect(section.lines.some((line) => line.includes("(not refreshed)"))).toBe(true);
    expect(section.problems.some((problem) => problem.summary.includes("no route to host"))).toBe(
      true,
    );
  });

  it("labels unrefreshed figures without a problem when the fetch was merely skipped", () => {
    const section = gitSection(repoStatus({ refreshed: false, fetchError: null }));
    expect(section.lines.some((line) => line.includes("(not refreshed)"))).toBe(true);
    expect(section.problems).toEqual([]);
  });

  it("flags a directory that is not a git repository", () => {
    const section = gitSection(repoStatus({ error: "fatal: not a git repository" }));
    expect(section.problems).toHaveLength(1);
    expect(section.lines).toHaveLength(1);
  });
});

describe("assembleReport / renderText / toJson", () => {
  function section(id: CheckSection["id"], problems: string[] = []): CheckSection {
    return {
      id,
      title: id,
      lines: [`${id} line`],
      problems: problems.map((summary) => ({ section: id, summary })),
      data: { id },
    };
  }

  const all = (): CheckSection[] => SECTION_ORDER.map((id) => section(id));

  it("orders the sections regardless of the order they were supplied in", () => {
    const report = assembleReport({
      generatedAt: NOW,
      repo: "acme/widgets",
      offline: false,
      sections: [...all()].reverse(),
    });
    expect(report.sections.map((entry) => entry.id)).toEqual([...SECTION_ORDER]);
  });

  it("flattens the problems in section order and derives the exit code from them", () => {
    const report = assembleReport({
      generatedAt: NOW,
      repo: "acme/widgets",
      offline: false,
      sections: [section("environment", ["env bad"]), section("lock", ["lock bad"])],
    });
    expect(report.problems.map((problem) => problem.section)).toEqual(["lock", "environment"]);
    expect(report.exitCode).toBe(1);
  });

  it("exits 0 with no problems", () => {
    const report = assembleReport({
      generatedAt: NOW,
      repo: "acme/widgets",
      offline: false,
      sections: all(),
    });
    expect(report.exitCode).toBe(0);
  });

  it("renders every section even when one found nothing to say", () => {
    const sections = all();
    sections[2] = { ...sections[2], lines: [] };
    const text = renderText(
      assembleReport({ generatedAt: NOW, repo: "acme/widgets", offline: false, sections }),
    );
    for (const id of SECTION_ORDER) expect(text).toContain(id);
    expect(text).toContain("(nothing to report)");
  });

  it("ends with a healthy verdict and no Problems block", () => {
    const text = renderText(
      assembleReport({ generatedAt: NOW, repo: "acme/widgets", offline: false, sections: all() }),
    );
    expect(text.trimEnd().endsWith("RESULT: healthy")).toBe(true);
    expect(text).not.toContain("Problems (");
  });

  it("ends with a count and lists the problems when there are any", () => {
    const text = renderText(
      assembleReport({
        generatedAt: NOW,
        repo: "acme/widgets",
        offline: false,
        sections: [section("lock", ["a"]), section("git", ["b"])],
      }),
    );
    expect(text).toContain("Problems (2)");
    expect(text).toContain("· lock: a");
    expect(text.trimEnd().endsWith("RESULT: 2 problem(s) found")).toBe(true);
  });

  it("emits JSON keyed by section id, matching the contract", () => {
    const json = toJson(
      assembleReport({
        generatedAt: NOW,
        repo: "acme/widgets",
        offline: true,
        sections: [section("lock", ["a"])],
      }),
    );
    expect(json.generatedAt).toBe(NOW.toISOString());
    expect(json.repo).toBe("acme/widgets");
    expect(json.offline).toBe(true);
    expect(json.exitCode).toBe(1);
    expect(json.problems).toEqual([{ section: "lock", summary: "a" }]);
    const sections = json.sections as Record<string, { data: unknown; lines: string[] }>;
    expect(Object.keys(sections)).toEqual(["lock"]);
    expect(sections["lock"].data).toEqual({ id: "lock" });
  });
});

describe("describeDuration", () => {
  it("scales the unit to the magnitude", () => {
    expect(describeDuration(45 * 1000)).toBe("45s");
    expect(describeDuration(4 * MINUTE)).toBe("4m");
    expect(describeDuration(125 * MINUTE)).toBe("2h 5m");
    expect(describeDuration(50 * 60 * MINUTE)).toBe("2d 2h");
  });

  it("does not print a negative duration as a large positive one", () => {
    expect(describeDuration(-1000)).toBe("in the future");
  });
});
