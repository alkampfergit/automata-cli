import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EXECUTION_LOG_FILE,
  WORK_LOG_FILE,
  formatExecutionLine,
  formatWorkRecord,
  readExecutionTicks,
  readWorkRecords,
  type TickLog,
  type TickLogItem,
} from "../../src/run/operationLog.js";

/**
 * The reader's contract is the writer's format, so nearly every test here drives
 * a `TickLog` through `formatExecutionLine` / `formatWorkRecord` and parses the
 * result back. A renamed or reordered field then fails here rather than being
 * discovered by an operator staring at a report full of zeroes.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "automata-logread-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function item(overrides: Partial<TickLogItem> = {}): TickLogItem {
  return {
    subject: "#42",
    turn: "issue-discuss",
    outcome: "answered",
    detail: "posted an answer",
    ranExecutor: true,
    executor: "claude",
    model: "opus",
    effort: "high",
    ...overrides,
  };
}

function tick(overrides: Partial<TickLog> = {}): TickLog {
  return {
    command: "do-work",
    repo: "acme/widgets",
    timestamp: new Date("2026-01-10T00:00:00.000Z"),
    durationMs: 12_300,
    exitCode: 0,
    items: [item()],
    ...overrides,
  };
}

function writeExecution(...ticks: TickLog[]): void {
  writeFileSync(join(dir, EXECUTION_LOG_FILE), ticks.map(formatExecutionLine).join(""), "utf8");
}

function writeWork(...ticks: TickLog[]): void {
  const records = ticks.map(formatWorkRecord).filter((record): record is string => record !== null);
  writeFileSync(join(dir, WORK_LOG_FILE), records.join(""), "utf8");
}

describe("readExecutionTicks", () => {
  it("round-trips a line the formatter wrote", () => {
    writeExecution(
      tick({
        items: [
          item(),
          item({ outcome: "skipped", ranExecutor: false }),
          item({ outcome: "failed" }),
        ],
      }),
    );

    const read = readExecutionTicks({ dir });
    expect(read.present).toBe(true);
    expect(read.entries).toHaveLength(1);
    const parsed = read.entries[0];
    expect(parsed.timestamp.toISOString()).toBe("2026-01-10T00:00:00.000Z");
    expect(parsed.command).toBe("do-work");
    expect(parsed.repo).toBe("acme/widgets");
    expect(parsed.items).toBe(3);
    expect(parsed.counts).toEqual({
      answered: 1,
      "answered-no-reply": 0,
      skipped: 1,
      failed: 1,
      deferred: 0,
    });
    expect(parsed.runs).toBe(2);
    expect(parsed.exitCode).toBe(0);
    expect(parsed.durationSeconds).toBeCloseTo(12.3);
    expect(parsed.note).toBeNull();
  });

  it("round-trips the note a lock-held tick carries", () => {
    writeExecution(tick({ items: [], note: "lock-held", exitCode: 0 }));
    expect(readExecutionTicks({ dir }).entries[0].note).toBe("lock-held");
  });

  it("returns ticks newest first", () => {
    writeExecution(
      tick({ timestamp: new Date("2026-01-10T00:00:00Z") }),
      tick({ timestamp: new Date("2026-01-11T00:00:00Z") }),
      tick({ timestamp: new Date("2026-01-12T00:00:00Z") }),
    );
    const read = readExecutionTicks({ dir });
    expect(read.entries.map((entry) => entry.timestamp.toISOString())).toEqual([
      "2026-01-12T00:00:00.000Z",
      "2026-01-11T00:00:00.000Z",
      "2026-01-10T00:00:00.000Z",
    ]);
  });

  it("caps at the limit, keeping the newest", () => {
    writeExecution(
      tick({ timestamp: new Date("2026-01-10T00:00:00Z") }),
      tick({ timestamp: new Date("2026-01-11T00:00:00Z") }),
      tick({ timestamp: new Date("2026-01-12T00:00:00Z") }),
    );
    const read = readExecutionTicks({ dir, limit: 2 });
    expect(read.entries.map((entry) => entry.timestamp.toISOString())).toEqual([
      "2026-01-12T00:00:00.000Z",
      "2026-01-11T00:00:00.000Z",
    ]);
  });

  it("filters by repository and counts what it dropped", () => {
    writeExecution(
      tick({ repo: "acme/widgets" }),
      tick({ repo: "acme/other" }),
      tick({ repo: "acme/other" }),
    );
    const read = readExecutionTicks({ dir, repo: "acme/widgets" });
    expect(read.entries).toHaveLength(1);
    expect(read.otherRepos).toBe(2);
  });

  it("keeps an entry whose own slug was unresolvable, whatever the filter", () => {
    // Those are the ticks that ran in a checkout with a broken remote — the
    // ones most worth reporting, so the filter must not hide them.
    writeExecution(tick({ repo: null }));
    const read = readExecutionTicks({ dir, repo: "acme/widgets" });
    expect(read.entries).toHaveLength(1);
    expect(read.entries[0].repo).toBeNull();
  });

  it("skips and counts a malformed line instead of failing the whole read", () => {
    writeFileSync(
      join(dir, EXECUTION_LOG_FILE),
      "not a log line at all\n" + formatExecutionLine(tick()) + "2026-13-45 do-work exit=0\n",
      "utf8",
    );
    const read = readExecutionTicks({ dir });
    expect(read.entries).toHaveLength(1);
    expect(read.skipped).toBe(2);
  });

  it("reads a line written by an older automata, missing an outcome bucket", () => {
    writeFileSync(
      join(dir, EXECUTION_LOG_FILE),
      "2026-01-10T00:00:00.000Z do-work repo=acme/widgets items=1 answered=1 runs=1 exit=0 dur=1.0s\n",
      "utf8",
    );
    const read = readExecutionTicks({ dir });
    expect(read.entries[0].counts.deferred).toBe(0);
    expect(read.entries[0].counts.answered).toBe(1);
    expect(read.skipped).toBe(0);
  });

  it("distinguishes an absent log from an empty one", () => {
    const absent = readExecutionTicks({ dir });
    expect(absent.present).toBe(false);
    expect(absent.error).toBeNull();
    expect(absent.entries).toEqual([]);

    writeFileSync(join(dir, EXECUTION_LOG_FILE), "", "utf8");
    const empty = readExecutionTicks({ dir });
    expect(empty.present).toBe(true);
    expect(empty.entries).toEqual([]);
  });

  it("voids a line whose numeric field is not a number, rather than reading it as zero", () => {
    // `items=oops` used to pass through `Number.parseInt(...) || 0` and be
    // reported as a clean zero-item tick, hiding corrupted history behind a
    // healthy report.
    writeFileSync(
      join(dir, EXECUTION_LOG_FILE),
      "2026-01-10T00:00:00.000Z do-work repo=acme/widgets items=oops answered=0 " +
        "answered-no-reply=0 skipped=0 failed=0 deferred=0 runs=0 exit=0 dur=1.0s\n",
      "utf8",
    );
    const read = readExecutionTicks({ dir });
    expect(read.entries).toHaveLength(0);
    expect(read.skipped).toBe(1);
  });

  it("voids a line whose outcome bucket is not a number", () => {
    writeFileSync(
      join(dir, EXECUTION_LOG_FILE),
      "2026-01-10T00:00:00.000Z do-work repo=acme/widgets items=1 answered=1x " +
        "answered-no-reply=0 skipped=0 failed=0 deferred=0 runs=0 exit=0 dur=1.0s\n",
      "utf8",
    );
    expect(readExecutionTicks({ dir }).entries).toHaveLength(0);
  });

  it("says so when no repository filter was applied", () => {
    writeExecution(tick());
    expect(readExecutionTicks({ dir }).filtered).toBe(false);
    expect(readExecutionTicks({ dir, repo: "acme/widgets" }).filtered).toBe(true);
  });
});

describe("readWorkRecords", () => {
  it("round-trips a record the formatter wrote", () => {
    writeWork(
      tick({
        items: [
          item(),
          item({
            subject: "PR #61",
            turn: "pr-orphan",
            outcome: "failed",
            detail: "executor exited 1",
          }),
        ],
      }),
    );

    const read = readWorkRecords({ dir });
    expect(read.entries).toHaveLength(1);
    const record = read.entries[0];
    expect(record.timestamp.toISOString()).toBe("2026-01-10T00:00:00.000Z");
    expect(record.repo).toBe("acme/widgets");
    expect(record.items).toEqual([
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
      {
        subject: "PR #61",
        turn: "pr-orphan",
        outcome: "failed",
        executor: "claude",
        model: "opus",
        effort: "high",
        sync: null,
        detail: "executor exited 1",
      },
    ]);
  });

  it("round-trips the synchronisation strategy the writer records", () => {
    // The `sync=` field sits between the executor bracket and the em dash. A
    // reader that does not expect it counts the line as unparsable, which drops
    // from the report precisely the items whose branch needed more than a
    // fast-forward — the failure `sync=` exists to make visible.
    writeWork(
      tick({
        items: [
          item({ sync: "rebase" }),
          item({ subject: "PR #61", sync: "pull-failed", outcome: "skipped" }),
        ],
      }),
    );

    const record = readWorkRecords({ dir }).entries[0];
    expect(record.items.map((entry) => entry.sync)).toEqual(["rebase", "pull-failed"]);
    expect(record.items[0].detail).toBe("posted an answer");
    expect(record.items[0].executor).toBe("claude");
  });

  it("parses a two-token subject without mis-splitting the turn", () => {
    // `PR #61` is two tokens and `#42` is one, so counting fields from the left
    // would put the turn kind in the wrong column for every orphan record.
    writeWork(tick({ items: [item({ subject: "PR #61", turn: "pr-orphan" })] }));
    const parsed = readWorkRecords({ dir }).entries[0].items[0];
    expect(parsed.subject).toBe("PR #61");
    expect(parsed.turn).toBe("pr-orphan");
  });

  it("parses an item with no executor recorded", () => {
    writeWork(
      tick({ items: [item({ executor: undefined, model: undefined, effort: undefined })] }),
    );
    const parsed = readWorkRecords({ dir }).entries[0].items[0];
    expect(parsed.executor).toBeNull();
    expect(parsed.model).toBeNull();
    expect(parsed.effort).toBeNull();
  });

  it("parses a null turn as null rather than as the literal dash", () => {
    writeWork(tick({ items: [item({ turn: null })] }));
    expect(readWorkRecords({ dir }).entries[0].items[0].turn).toBeNull();
  });

  it("returns records newest first and honours the limit", () => {
    writeWork(
      tick({ timestamp: new Date("2026-01-10T00:00:00Z") }),
      tick({ timestamp: new Date("2026-01-11T00:00:00Z") }),
      tick({ timestamp: new Date("2026-01-12T00:00:00Z") }),
    );
    const read = readWorkRecords({ dir, limit: 2 });
    expect(read.entries.map((entry) => entry.timestamp.toISOString())).toEqual([
      "2026-01-12T00:00:00.000Z",
      "2026-01-11T00:00:00.000Z",
    ]);
  });

  it("filters by repository and counts the records it dropped", () => {
    writeWork(tick({ repo: "acme/widgets" }), tick({ repo: "acme/other" }));
    const read = readWorkRecords({ dir, repo: "acme/widgets" });
    expect(read.entries).toHaveLength(1);
    expect(read.otherRepos).toBe(1);
  });

  it("counts the preamble `pruneOldRecords` preserves rather than choking on it", () => {
    writeFileSync(
      join(dir, WORK_LOG_FILE),
      "a hand-written note nobody meant to leave here\n" + (formatWorkRecord(tick()) ?? ""),
      "utf8",
    );
    const read = readWorkRecords({ dir });
    expect(read.entries).toHaveLength(1);
    expect(read.skipped).toBe(1);
  });

  it("reports an absent work log without an error", () => {
    const read = readWorkRecords({ dir });
    expect(read.present).toBe(false);
    expect(read.error).toBeNull();
  });
  it("counts a malformed header without discarding the record in progress", () => {
    // One bad header used to close the current record and orphan every item
    // line after it, so a single damaged line hid the work history that followed.
    writeFileSync(
      join(dir, WORK_LOG_FILE),
      "=== 2026-01-10T00:00:00.000Z acme/widgets ===\n" +
        "=== not-a-timestamp acme/widgets ===\n" +
        "#42 issue-discuss answered [claude model=opus] — posted an answer\n",
      "utf8",
    );
    const read = readWorkRecords({ dir });
    expect(read.entries).toHaveLength(1);
    expect(read.entries[0].items).toHaveLength(1);
    expect(read.skipped).toBe(1);
  });

  it("says so when no repository filter was applied", () => {
    writeWork(tick());
    expect(readWorkRecords({ dir }).filtered).toBe(false);
    expect(readWorkRecords({ dir, repo: "acme/widgets" }).filtered).toBe(true);
  });
});
