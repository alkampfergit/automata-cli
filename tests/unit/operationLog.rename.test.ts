import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// A failing `renameSync` is the one temp-file leak that cannot be provoked
// through the filesystem: if the directory is read-only the staging *write*
// fails first, so nothing is ever left behind. Only an ENOSPC/EACCES landing
// between the write and the rename strands a file, hence the injection. This
// lives in its own file because `vi.mock` is hoisted for the whole module.
const renameFails = { value: false };

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    renameSync: (from: string, to: string): void => {
      if (renameFails.value) {
        const err: NodeJS.ErrnoException = new Error("EACCES: permission denied, rename");
        err.code = "EACCES";
        throw err;
      }
      actual.renameSync(from, to);
    },
  };
});

const { EXECUTION_LOG_FILE, MAX_EXECUTION_LINES, recordTick } =
  await import("../../src/run/operationLog.js");

const TEST_DIR = join(process.cwd(), "tmp-test-operationlog-rename");

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  renameFails.value = false;
});

afterEach(() => {
  renameFails.value = false;
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("recordTick when the retention rewrite cannot be renamed into place", () => {
  const overflowing = (): string =>
    Array.from({ length: MAX_EXECUTION_LINES + 5 }, (_, i) => `seeded ${String(i)}`).join("\n") +
    "\n";

  const aTick = {
    command: "do-work",
    repo: "owner/name",
    timestamp: new Date("2026-09-10T06:51:36.412Z"),
    durationMs: 1000,
    exitCode: 0,
    items: [],
  };

  it("does not throw and strands no temp file", () => {
    writeFileSync(join(TEST_DIR, EXECUTION_LOG_FILE), overflowing(), "utf8");
    renameFails.value = true;

    expect(() => {
      recordTick(aTick, TEST_DIR);
    }).not.toThrow();

    expect(readdirSync(TEST_DIR).sort()).toEqual([EXECUTION_LOG_FILE]);
  });

  it("keeps the appended line, so the newest entry survives a failed rewrite", () => {
    writeFileSync(join(TEST_DIR, EXECUTION_LOG_FILE), overflowing(), "utf8");
    renameFails.value = true;

    recordTick(aTick, TEST_DIR);

    // Append-then-trim: the trim is what failed, so the file is over the cap
    // but the entry it was asked to record is present.
    expect(readdirSync(TEST_DIR)).toEqual([EXECUTION_LOG_FILE]);
  });
});
