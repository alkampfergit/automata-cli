import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  EXECUTION_LOG_FILE,
  MAX_DETAIL_LENGTH,
  MAX_EXECUTION_LINES,
  WORK_LOG_FILE,
  WORK_RECORD_MAX_AGE_DAYS,
  formatExecutionLine,
  formatWorkRecord,
  operationLogDirectory,
  pruneOldRecords,
  recordTick,
  trimToLastLines,
  type TickLog,
  type TickLogItem,
} from "../../src/run/operationLog.js";

const TEST_DIR = join(process.cwd(), "tmp-test-operationlog");
const DAY_MS = 24 * 60 * 60 * 1000;

function item(overrides: Partial<TickLogItem> = {}): TickLogItem {
  return {
    issue: 53,
    turn: "issue-discuss",
    outcome: "answered",
    detail: "posted a reply",
    ranExecutor: true,
    ...overrides,
  };
}

function tick(overrides: Partial<TickLog> = {}): TickLog {
  return {
    command: "do-work",
    repo: "alkampfergit/automata-cli",
    timestamp: new Date("2026-09-10T06:51:36.412Z"),
    durationMs: 42_100,
    exitCode: 0,
    items: [],
    ...overrides,
  };
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  // A permission test may have removed write access; restore it so the tree can go.
  try {
    chmodSync(TEST_DIR, 0o755);
  } catch {
    /* already gone */
  }
  rmSync(TEST_DIR, { recursive: true, force: true });
});

/* ── formatExecutionLine ─────────────────────────────────────────────────── */

describe("formatExecutionLine", () => {
  it("emits one line with every outcome bucket, even at zero", () => {
    const line = formatExecutionLine(tick({ items: [item()] }));
    expect(line.endsWith("\n")).toBe(true);
    expect(line.trimEnd().includes("\n")).toBe(false);
    expect(line).toBe(
      "2026-09-10T06:51:36.412Z do-work repo=alkampfergit/automata-cli items=1 " +
        "answered=1 answered-no-reply=0 skipped=0 failed=0 deferred=0 runs=1 exit=0 dur=42.1s\n",
    );
  });

  it("counts each outcome and only executor invocations as runs", () => {
    const line = formatExecutionLine(
      tick({
        exitCode: 2,
        items: [
          item({ issue: 1, outcome: "answered" }),
          item({ issue: 2, outcome: "answered-no-reply" }),
          item({ issue: 3, outcome: "failed" }),
          item({ issue: 4, outcome: "skipped", ranExecutor: false }),
          item({ issue: 5, outcome: "deferred", ranExecutor: false }),
        ],
      }),
    );
    expect(line).toContain("items=5");
    expect(line).toContain("answered=1");
    expect(line).toContain("answered-no-reply=1");
    expect(line).toContain("failed=1");
    expect(line).toContain("skipped=1");
    expect(line).toContain("deferred=1");
    expect(line).toContain("runs=3");
    expect(line).toContain("exit=2");
  });

  it("records an empty tick", () => {
    const line = formatExecutionLine(tick({ durationMs: 1800 }));
    expect(line).toContain("items=0");
    expect(line).toContain("runs=0");
    expect(line).toContain("dur=1.8s");
  });

  it("writes repo=- when the slug could not be resolved", () => {
    expect(formatExecutionLine(tick({ repo: null }))).toContain("repo=-");
    expect(formatExecutionLine(tick({ repo: "  " }))).toContain("repo=-");
  });

  it("appends the note only when one is present", () => {
    expect(
      formatExecutionLine(tick({ note: "lock-held" }))
        .trimEnd()
        .endsWith("note=lock-held"),
    ).toBe(true);
    expect(formatExecutionLine(tick())).not.toContain("note=");
  });
});

/* ── formatWorkRecord ────────────────────────────────────────────────────── */

describe("formatWorkRecord", () => {
  it("returns null when no item reached the executor", () => {
    expect(formatWorkRecord(tick())).toBeNull();
    expect(
      formatWorkRecord(
        tick({
          items: [item({ outcome: "deferred", ranExecutor: false }), item({ ranExecutor: false })],
        }),
      ),
    ).toBeNull();
  });

  it("lists only the items that reached the executor", () => {
    const record = formatWorkRecord(
      tick({
        items: [
          item({ issue: 53 }),
          item({ issue: 99, outcome: "deferred", detail: "run cap reached", ranExecutor: false }),
        ],
      }),
    );
    expect(record).not.toBeNull();
    expect(record).toContain("#53");
    expect(record).not.toContain("#99");
  });

  it("writes a header, one line per item and a trailing blank line", () => {
    const record = formatWorkRecord(
      tick({
        items: [
          item({ issue: 53, executor: "claude", model: "opus-5" }),
          item({
            issue: 51,
            turn: "pr-work",
            detail: "pushed 2 commits",
            executor: "codex",
            effort: "high",
          }),
        ],
      }),
    );
    expect(record).toBe(
      "=== 2026-09-10T06:51:36.412Z alkampfergit/automata-cli ===\n" +
        "#53 issue-discuss answered [claude model=opus-5] — posted a reply\n" +
        "#51 pr-work answered [codex effort=high] — pushed 2 commits\n" +
        "\n",
    );
  });

  it("omits the executor bracket when nothing was resolved and renders a null turn", () => {
    const record = formatWorkRecord(tick({ items: [item({ turn: null })] })) ?? "";
    expect(record).toContain("#53 - answered — posted a reply");
  });

  it("collapses newlines so one item is always one line", () => {
    const record =
      formatWorkRecord(tick({ items: [item({ detail: "line one\nline two\n\nline three" })] })) ??
      "";
    const body = record.split("\n")[1];
    expect(body).toContain("line one line two line three");
  });

  it("truncates a long detail", () => {
    const record = formatWorkRecord(tick({ items: [item({ detail: "x".repeat(500) })] })) ?? "";
    const body = record.split("\n")[1];
    expect(body.endsWith("…")).toBe(true);
    expect(body).toContain("x".repeat(MAX_DETAIL_LENGTH));
    expect(body).not.toContain("x".repeat(MAX_DETAIL_LENGTH + 1));
  });
});

/* ── trimToLastLines ─────────────────────────────────────────────────────── */

describe("trimToLastLines", () => {
  const lines = (count: number, offset = 0): string =>
    Array.from({ length: count }, (_, i) => `line ${String(i + offset)}`).join("\n") + "\n";

  it("leaves content at or below the limit untouched", () => {
    expect(trimToLastLines(lines(3), 5)).toBe(lines(3));
    expect(trimToLastLines(lines(5), 5)).toBe(lines(5));
    expect(trimToLastLines("", 5)).toBe("");
  });

  it("does not count a trailing newline as a line", () => {
    // Three lines plus a terminator must not be treated as four.
    expect(trimToLastLines("a\nb\nc\n", 3)).toBe("a\nb\nc\n");
  });

  it("keeps the newest lines when over the limit", () => {
    expect(trimToLastLines(lines(7), 3)).toBe("line 4\nline 5\nline 6\n");
  });

  it("handles content with no trailing newline", () => {
    expect(trimToLastLines("a\nb\nc", 2)).toBe("b\nc\n");
  });

  it("holds the execution log at exactly the 1000-line cap", () => {
    const overflowing = lines(MAX_EXECUTION_LINES + 1);
    const trimmed = trimToLastLines(overflowing, MAX_EXECUTION_LINES);
    const kept = trimmed.split("\n").filter((line) => line.length > 0);
    expect(kept).toHaveLength(MAX_EXECUTION_LINES);
    expect(kept[0]).toBe("line 1");
    expect(kept[kept.length - 1]).toBe(`line ${String(MAX_EXECUTION_LINES)}`);
  });
});

/* ── pruneOldRecords ─────────────────────────────────────────────────────── */

describe("pruneOldRecords", () => {
  const NOW = new Date("2026-09-10T00:00:00.000Z");
  const MAX_AGE = WORK_RECORD_MAX_AGE_DAYS * DAY_MS;

  const record = (iso: string, body: string): string => `=== ${iso} owner/name ===\n${body}\n\n`;

  it("returns empty content unchanged", () => {
    expect(pruneOldRecords("", NOW, MAX_AGE)).toBe("");
  });

  it("is a no-op when every record is recent", () => {
    const content =
      record("2026-09-05T00:00:00.000Z", "#1 issue-discuss answered — a") +
      record("2026-09-09T00:00:00.000Z", "#2 pr-work answered — b");
    expect(pruneOldRecords(content, NOW, MAX_AGE)).toBe(content);
  });

  it("drops a record older than the window and keeps a recent one", () => {
    const old = record("2026-08-01T00:00:00.000Z", "#1 issue-discuss answered — old");
    const recent = record("2026-09-05T00:00:00.000Z", "#2 pr-work answered — recent");
    const pruned = pruneOldRecords(old + recent, NOW, MAX_AGE);
    expect(pruned).toBe(recent);
    expect(pruned).not.toContain("old");
  });

  it("keeps a record whose header timestamp does not parse", () => {
    const broken = "=== not-a-date owner/name ===\n#1 issue-discuss answered — kept\n\n";
    const old = record("2026-08-01T00:00:00.000Z", "#2 pr-work answered — dropped");
    const pruned = pruneOldRecords(broken + old, NOW, MAX_AGE);
    expect(pruned).toBe(broken);
  });

  it("preserves text before the first header", () => {
    const preamble = "a hand-written note\n";
    const old = record("2026-08-01T00:00:00.000Z", "#1 issue-discuss answered — dropped");
    const recent = record("2026-09-09T00:00:00.000Z", "#2 pr-work answered — kept");
    expect(pruneOldRecords(preamble + old + recent, NOW, MAX_AGE)).toBe(preamble + recent);
  });

  it("leaves a newline-terminated result when only a preamble survives", () => {
    const preamble = "orphan text\n";
    const old = record("2026-08-01T00:00:00.000Z", "#1 issue-discuss answered — dropped");
    const pruned = pruneOldRecords(preamble + old, NOW, MAX_AGE);
    expect(pruned).toBe("orphan text\n");
  });
});

/* ── operationLogDirectory ───────────────────────────────────────────────── */

describe("operationLogDirectory", () => {
  it("is the parent of the working directory", () => {
    const original = process.cwd;
    process.cwd = () => "/home/dev/workspaces/automata-cli";
    try {
      expect(operationLogDirectory()).toBe("/home/dev/workspaces");
    } finally {
      process.cwd = original;
    }
  });
});

/* ── recordTick ──────────────────────────────────────────────────────────── */

describe("recordTick", () => {
  const executionLog = (): string => readFileSync(join(TEST_DIR, EXECUTION_LOG_FILE), "utf8");
  const workLog = (): string => readFileSync(join(TEST_DIR, WORK_LOG_FILE), "utf8");

  it("creates both files and appends across invocations", () => {
    recordTick(tick({ items: [item({ issue: 1 })] }), TEST_DIR);
    recordTick(
      tick({ timestamp: new Date("2026-09-10T07:00:00.000Z"), items: [item({ issue: 2 })] }),
      TEST_DIR,
    );

    const lines = executionLog()
      .split("\n")
      .filter((line) => line.length > 0);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("2026-09-10T06:51:36.412Z");
    expect(lines[1]).toContain("2026-09-10T07:00:00.000Z");

    expect(workLog()).toContain("#1 issue-discuss answered");
    expect(workLog()).toContain("#2 issue-discuss answered");
  });

  it("writes an execution line but no work log when nothing ran", () => {
    recordTick(tick(), TEST_DIR);
    expect(executionLog()).toContain("items=0");
    expect(existsSync(join(TEST_DIR, WORK_LOG_FILE))).toBe(false);
  });

  it("leaves an existing work log untouched when nothing ran", () => {
    const existing =
      "=== 2026-09-09T00:00:00.000Z owner/name ===\n#7 pr-work answered — earlier\n\n";
    writeFileSync(join(TEST_DIR, WORK_LOG_FILE), existing, "utf8");
    recordTick(tick({ items: [item({ outcome: "skipped", ranExecutor: false })] }), TEST_DIR);
    expect(workLog()).toBe(existing);
  });

  it("holds the execution log at the 1000-line cap", () => {
    const seed =
      Array.from({ length: MAX_EXECUTION_LINES }, (_, i) => `seeded ${String(i)}`).join("\n") +
      "\n";
    writeFileSync(join(TEST_DIR, EXECUTION_LOG_FILE), seed, "utf8");

    recordTick(tick(), TEST_DIR);

    const lines = executionLog()
      .split("\n")
      .filter((line) => line.length > 0);
    expect(lines).toHaveLength(MAX_EXECUTION_LINES);
    expect(lines[0]).toBe("seeded 1");
    expect(lines[0]).not.toBe("seeded 0");
    expect(lines[lines.length - 1]).toContain("do-work repo=alkampfergit/automata-cli");
  });

  it("prunes work records older than 30 days when appending", () => {
    const now = new Date("2026-09-10T00:00:00.000Z");
    const stale = new Date(now.getTime() - 40 * DAY_MS).toISOString();
    const fresh = new Date(now.getTime() - 5 * DAY_MS).toISOString();
    writeFileSync(
      join(TEST_DIR, WORK_LOG_FILE),
      `=== ${stale} owner/name ===\n#1 pr-work answered — stale\n\n` +
        `=== ${fresh} owner/name ===\n#2 pr-work answered — fresh\n\n`,
      "utf8",
    );

    recordTick(tick({ timestamp: now, items: [item({ issue: 3, detail: "new" })] }), TEST_DIR);

    const content = workLog();
    expect(content).not.toContain("stale");
    expect(content).toContain("fresh");
    expect(content).toContain("#3 issue-discuss answered — new");
  });

  it("leaves no temp file behind after a rewrite", () => {
    writeFileSync(
      join(TEST_DIR, EXECUTION_LOG_FILE),
      Array.from({ length: MAX_EXECUTION_LINES + 5 }, (_, i) => `seeded ${String(i)}`).join("\n") +
        "\n",
      "utf8",
    );
    recordTick(tick(), TEST_DIR);
    expect(existsSync(join(TEST_DIR, `${EXECUTION_LOG_FILE}.${String(process.pid)}.tmp`))).toBe(
      false,
    );
  });

  it("does nothing and does not throw when the directory does not exist", () => {
    const missing = join(TEST_DIR, "no", "such", "dir");
    expect(() => {
      recordTick(tick({ items: [item()] }), missing);
    }).not.toThrow();
    expect(existsSync(missing)).toBe(false);
  });

  it("does nothing and does not throw when the directory is not writable", () => {
    const locked = join(TEST_DIR, "locked");
    mkdirSync(locked, { recursive: true });
    chmodSync(locked, 0o555);
    try {
      expect(() => {
        recordTick(tick({ items: [item()] }), locked);
      }).not.toThrow();
      expect(existsSync(join(locked, EXECUTION_LOG_FILE))).toBe(false);
      expect(existsSync(join(locked, WORK_LOG_FILE))).toBe(false);
    } finally {
      chmodSync(locked, 0o755);
    }
  });

  it("appends despite an unparseable existing work log", () => {
    writeFileSync(join(TEST_DIR, WORK_LOG_FILE), "not a record at all\n", "utf8");
    expect(() => {
      recordTick(tick({ items: [item()] }), TEST_DIR);
    }).not.toThrow();
    expect(workLog()).toContain("not a record at all");
    expect(workLog()).toContain("#53 issue-discuss answered");
  });
});
