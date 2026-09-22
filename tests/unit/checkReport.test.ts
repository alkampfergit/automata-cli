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
import type {
  ExecutionTick,
  LogDirectoryStatus,
  LogReadResult,
  WorkRecord,
} from "../../src/run/operationLog.js";
import type { LockStatus } from "../../src/run/runLock.js";
import type { Heartbeat } from "../../src/run/heartbeat.js";
import type { RepoStatus } from "../../src/git/repoStatus.js";

const NOW = new Date("2026-01-10T12:00:00.000Z");
const MINUTE = 60 * 1000;

/** The checking process, as `buildCheckReport` supplies it. */
const CTX = {
  cwd: "/srv/checkouts/widgets",
  logDirectory: "/srv/checkouts",
  parentOf: (dir: string) => dir.slice(0, dir.lastIndexOf("/")) || "/",
};

const DIR: LogDirectoryStatus = {
  dir: "/srv/checkouts",
  cwd: "/srv/checkouts/widgets",
  writable: true,
  detail: null,
};

/** The lock state a tick section is given unless a test cares about it. */
const FREE: LockStatus = { kind: "free" };

/** The first line matching `needle`, so a new line above one cannot break an assertion. */
function lineWith(section: CheckSection, needle: string): string | undefined {
  return section.lines.find((line) => line.includes(needle));
}

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
    const section = lockSection(status, 120, CTX, NOW);
    expect(section.problems).toEqual([]);
    expect(section.lines[0]).toContain("a tick is running");
    expect(section.lines[0]).toContain("pid 1234 on build-01");
  });

  it("reports a free lock with no problem", () => {
    expect(lockSection({ kind: "free" }, 120, CTX, NOW).problems).toEqual([]);
  });

  it("flags a suspect lock and names the staleness window", () => {
    const section = lockSection(
      { kind: "suspect", owner: owner(), heldForMs: 3 * 60 * MINUTE },
      120,
      CTX,
      NOW,
    );
    expect(section.problems).toHaveLength(1);
    expect(section.problems[0].section).toBe("lock");
    expect(section.problems[0].summary).toContain("120 minutes");
  });

  it("flags a stale lock but says it heals itself", () => {
    const section = lockSection({ kind: "stale", owner: owner(), heldForMs: null }, 120, CTX, NOW);
    expect(section.problems).toHaveLength(1);
    expect(section.problems[0].summary).toContain("the next tick reclaims it");
  });

  it("flags an unreadable lock, distinctly from a stale one", () => {
    const section = lockSection({ kind: "unreadable", detail: "EACCES" }, 120, CTX, NOW);
    expect(section.problems[0].summary).toContain("EACCES");
    expect(section.data.status).toBe("unreadable");
  });

  it("prints the holder's working directory", () => {
    const section = lockSection(
      { kind: "held", owner: owner({ cwd: CTX.cwd }), heldForMs: MINUTE },
      120,
      CTX,
      NOW,
    );
    expect(lineWith(section, "working directory:")).toContain(CTX.cwd);
    expect(section.problems).toEqual([]);
  });

  it("flags a holder that logs somewhere other than where this check reads", () => {
    const section = lockSection(
      { kind: "held", owner: owner({ cwd: "/home/ci/widgets" }), heldForMs: MINUTE },
      120,
      CTX,
      NOW,
    );
    expect(lineWith(section, "logs to")).toBe("  logs to /home/ci (this check reads /srv/checkouts)");
    expect(section.problems).toHaveLength(1);
    expect(section.problems[0].summary).toContain("/home/ci");
    expect(section.problems[0].summary).toContain("/srv/checkouts");
    expect(section.problems[0].command).toContain("/home/ci/automata-execution.log");
  });

  it("says a lock without a recorded directory is old, not broken", () => {
    const section = lockSection({ kind: "held", owner: owner(), heldForMs: MINUTE }, 120, CTX, NOW);
    expect(lineWith(section, "working directory:")).toContain("older automata");
    expect(section.problems).toEqual([]);
  });

  it("renders the holder's heartbeat: phase, item and executor", () => {
    const heartbeat: Heartbeat = {
      token: "tok-1",
      updatedAt: new Date(NOW.getTime() - 12 * 1000).toISOString(),
      phase: "item",
      item: { index: 3, total: 8, subject: "#82" },
      executor: { command: "claude", startedAt: new Date(NOW.getTime() - 2 * MINUTE).toISOString() },
    };
    const section = lockSection(
      { kind: "held", owner: owner(), heldForMs: 4 * MINUTE, heartbeat },
      120,
      CTX,
      NOW,
    );
    expect(lineWith(section, "phase:")).toBe("  phase: item — item 3 of 8, #82 (updated 12s ago)");
    expect(lineWith(section, "executor:")).toBe("  executor: claude, running for 2m");
  });

  it("says so when a held lock has no heartbeat", () => {
    const section = lockSection({ kind: "held", owner: owner(), heldForMs: MINUTE }, 120, CTX, NOW);
    expect(lineWith(section, "phase:")).toContain("no heartbeat from this holder");
  });

  it("renders a heartbeat for a suspect lock too, and still flags it", () => {
    const section = lockSection(
      {
        kind: "suspect",
        owner: owner(),
        heldForMs: 3 * 60 * MINUTE,
        heartbeat: {
          token: "tok-1",
          updatedAt: new Date(NOW.getTime() - 3 * 60 * MINUTE).toISOString(),
          phase: "discovery",
          item: null,
          executor: null,
        },
      },
      120,
      CTX,
      NOW,
    );
    expect(lineWith(section, "phase:")).toContain("discovery");
    expect(section.problems).toHaveLength(1);
    expect(section.problems[0].command).toContain("ps -p 1234");
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
      DIR,
      FREE,
    );
    const last = lineWith(section, "last tick:");
    expect(last).toContain("answered=1");
    expect(last).toContain("skipped=1");
    expect(last).toContain("exit=0");
    expect(last).toContain("(4m ago)");
    expect(section.problems).toEqual([]);
  });

  it("flags a missing execution log", () => {
    const section = tickSection(read<ExecutionTick>([], { present: false }), NOW, DIR, FREE);
    expect(section.problems).toHaveLength(1);
    expect(section.problems[0].summary).toContain("no execution log");
  });

  it("flags an unreadable execution log distinctly from a missing one", () => {
    const section = tickSection(read<ExecutionTick>([], { present: false, error: "EACCES" }), NOW, DIR, FREE);
    expect(section.problems[0].summary).toContain("EACCES");
  });

  it("flags a log that holds no tick for this repository", () => {
    const section = tickSection(read<ExecutionTick>([]), NOW, DIR, FREE);
    expect(section.problems[0].summary).toContain("never successfully run");
  });

  it("flags a non-zero exit on the newest tick", () => {
    const section = tickSection(read([tick({ exitCode: 2 })]), NOW, DIR, FREE);
    expect(section.problems.some((problem) => problem.summary.includes("exited 2"))).toBe(true);
  });

  it("flags scheduler silence with both the observed and the usual interval", () => {
    const section = tickSection(read(ticksEvery(5 * MINUTE, 10, 4 * 60 * MINUTE)), NOW, DIR, FREE);
    const silence = section.problems.find((problem) => problem.summary.includes("stopped firing"));
    expect(silence).toBeDefined();
    expect(silence?.summary).toContain("4h 0m");
    expect(silence?.summary).toContain("5m");
  });

  it("does not flag an idle loop that is still firing on schedule", () => {
    const section = tickSection(read(ticksEvery(5 * MINUTE, 10)), NOW, DIR, FREE);
    expect(section.problems).toEqual([]);
    expect(section.lines.some((line) => line.includes("about one tick every 5m"))).toBe(true);
  });

  it("flags a loop where every recorded tick was turned away by the lock", () => {
    const section = tickSection(
      read(ticksEvery(5 * MINUTE, 6).map((entry) => ({ ...entry, note: "lock-held" }))),
      NOW,
      DIR,
      FREE,
    );
    expect(section.problems.some((problem) => problem.summary.includes("wedged"))).toBe(true);
    expect(section.data.lockHeldCount).toBe(6);
  });

  it("always states the log directory, its derivation and its writability", () => {
    const section = tickSection(read(ticksEvery(5 * MINUTE, 10)), NOW, DIR, FREE);
    const line = lineWith(section, "log directory:");
    expect(line).toBe(
      "log directory: /srv/checkouts (the parent of the working directory /srv/checkouts/widgets), writable",
    );
    expect(section.problems).toEqual([]);
  });

  it("flags a log directory a tick cannot write to", () => {
    const section = tickSection(read(ticksEvery(5 * MINUTE, 10)), NOW, {
      dir: "/srv/checkouts",
      cwd: "/srv/checkouts/widgets",
      writable: false,
      detail: "EACCES: permission denied",
    }, FREE);
    expect(lineWith(section, "log directory:")).toContain("not writable: EACCES");
    expect(section.problems).toHaveLength(1);
    expect(section.problems[0].summary).toContain("records nothing");
    expect(section.problems[0].command).toBe("ls -ld /srv/checkouts");
  });

  it("does not call a missing log a problem while a tick is in flight", () => {
    // The contradiction in issue #82: a live pid beside "no tick has ever run".
    const held: LockStatus = { kind: "held", owner: owner(), heldForMs: 4 * MINUTE };
    const section = tickSection(read<ExecutionTick>([], { present: false }), NOW, DIR, held);
    expect(section.problems).toEqual([]);
    expect(section.lines.some((line) => line.includes("no execution log"))).toBe(true);
    expect(section.lines.some((line) => line.includes("has not recorded itself yet"))).toBe(true);
    expect(section.data.tickInFlight).toBe(true);
  });

  it("applies the same relief to a log holding no tick for this repository", () => {
    const held: LockStatus = { kind: "held", owner: owner(), heldForMs: 4 * MINUTE };
    expect(tickSection(read<ExecutionTick>([]), NOW, DIR, held).problems).toEqual([]);
  });

  it("keeps a missing log a problem when nothing is running", () => {
    const section = tickSection(read<ExecutionTick>([], { present: false }), NOW, DIR, FREE);
    expect(section.problems).toHaveLength(1);
    expect(section.lines.some((line) => line.includes("has not recorded itself yet"))).toBe(false);
  });

  it("keeps an unreadable log a problem even while a tick is in flight", () => {
    // A live tick explains an empty file; it explains nothing about permissions.
    const held: LockStatus = { kind: "held", owner: owner(), heldForMs: 4 * MINUTE };
    const section = tickSection(
      read<ExecutionTick>([], { present: false, error: "EACCES" }),
      NOW,
      DIR,
      held,
    );
    expect(section.problems).toHaveLength(1);
    expect(section.problems[0].summary).toContain("EACCES");
  });

  it("mentions unparseable lines and other repositories without calling them problems", () => {
    const section = tickSection(
      read(ticksEvery(5 * MINUTE, 5), { skipped: 2, otherRepos: 7 }),
      NOW,
      DIR,
      FREE,
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
    const section = workSection(read([record]), NOW, DIR, FREE);
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
      problems: problems.map((summary) => ({ section: id, summary, command: null })),
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
    expect(json.problems).toEqual([{ section: "lock", summary: "a", command: null }]);
    expect(json.trace).toBeNull();
    expect(json.blocked).toBeNull();
    const sections = json.sections as Record<string, { data: unknown; lines: string[] }>;
    expect(Object.keys(sections)).toEqual(["lock"]);
    expect(sections["lock"].data).toEqual({ id: "lock" });
  });

  it("prints the investigative command under the problem it belongs to", () => {
    const withCommand: CheckSection = {
      id: "lock",
      title: "Run lock",
      lines: ["line"],
      problems: [
        { section: "lock", summary: "the lock is held", command: "cat .automata/automata.lock" },
        { section: "lock", summary: "nothing investigates this", command: null },
      ],
      data: {},
    };
    const text = renderText(
      assembleReport({ generatedAt: NOW, repo: null, offline: false, sections: [withCommand] }),
    );
    expect(text).toContain("  · lock: the lock is held\n      try: cat .automata/automata.lock");
    // The null one prints nothing rather than an invented command.
    expect(text).toContain("  · lock: nothing investigates this\n\nRESULT");
  });

  it("renders the command trace after the sections and before the problems", () => {
    const text = renderText(
      assembleReport({
        generatedAt: NOW,
        repo: null,
        offline: false,
        sections: [section("lock", ["a"])],
        trace: [{ command: "git", args: ["status"], durationMs: 3, exitCode: 0 }],
      }),
    );
    expect(text).toContain("Commands (1)\n  git status — 3ms exit 0");
    expect(text.indexOf("Commands (1)")).toBeGreaterThan(text.indexOf("lock line"));
    expect(text.indexOf("Commands (1)")).toBeLessThan(text.indexOf("Problems (1)"));
  });

  it("omits the command block entirely when tracing was off", () => {
    const text = renderText(
      assembleReport({ generatedAt: NOW, repo: null, offline: false, sections: all() }),
    );
    expect(text).not.toContain("Commands");
  });

  it("says so when tracing was on and nothing ran", () => {
    const text = renderText(
      assembleReport({ generatedAt: NOW, repo: null, offline: false, sections: all(), trace: [] }),
    );
    expect(text).toContain("Commands (0)\n  (no git or gh command was run)");
  });

  it("heads a blocked dump with its trigger, above the usual header", () => {
    const report = assembleReport({
      generatedAt: NOW,
      repo: "acme/widgets",
      offline: true,
      sections: all(),
      blocked: { reason: "lock-held", trigger: "run lock held by pid 851554 on cisharpai" },
    });
    const text = renderText(report);
    expect(text.split("\n")[0]).toBe("blocked: run lock held by pid 851554 on cisharpai");
    expect(text.split("\n")[1]).toContain("automata do-work --check");
    expect(toJson(report).blocked).toEqual({
      reason: "lock-held",
      trigger: "run lock held by pid 851554 on cisharpai",
    });
  });

  it("keeps the six sections a blocked dump renders identical to the check's", () => {
    const blocked = assembleReport({
      generatedAt: NOW,
      repo: null,
      offline: true,
      sections: all(),
      blocked: { reason: "no-candidates", trigger: "no candidate was picked up (0 of 8)" },
    });
    const check = assembleReport({
      generatedAt: NOW,
      repo: null,
      offline: false,
      sections: all(),
    });
    expect(blocked.sections.map((s) => s.title)).toEqual(check.sections.map((s) => s.title));
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
