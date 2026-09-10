import {
  accessSync,
  appendFileSync,
  constants,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

/**
 * The operation log: a best-effort diagnostic record of what `do-work` did.
 *
 * A tick fired from cron discards its own stdout, so when the loop quietly
 * stops doing anything there is nothing left to look at. These two files are
 * that record, and they live *outside* the checkout — in its parent directory —
 * so several repositories under one workspace root share them and a `git clean`
 * cannot take the history with it.
 *
 * Everything here is best-effort by design. The logs are diagnostics, never a
 * deliverable, so no failure in this module may change the command's stdout,
 * its exit code, or whether the tick succeeded.
 */

/** One line per `do-work` invocation. */
export const EXECUTION_LOG_FILE = "automata-execution.log";

/** One record per invocation that actually invoked the executor. */
export const WORK_LOG_FILE = "automata-work.log";

export const MAX_EXECUTION_LINES = 1000;

export const WORK_RECORD_MAX_AGE_DAYS = 30;

/**
 * A `failed` outcome carries the executor's error message, which can run to
 * kilobytes. The work log is a brief summary, so one item is one line.
 */
export const MAX_DETAIL_LENGTH = 200;

/**
 * Declared here rather than imported from `do-work` to keep this module free of
 * command dependencies. It must stay in step with `Outcome` in
 * `src/commands/doWork.ts`; the `Record<OperationOutcome, number>` built below
 * turns any divergence into a compile error at the call site.
 */
export type OperationOutcome = "answered" | "answered-no-reply" | "skipped" | "failed" | "deferred";

const OUTCOMES: readonly OperationOutcome[] = [
  "answered",
  "answered-no-reply",
  "skipped",
  "failed",
  "deferred",
];

export interface TickLogItem {
  /**
   * How the item is named — `#42` for an issue, `PR #61` for a `pr-orphan`
   * turn, which has no issue. Rendered by the caller so that a work-log line
   * and the tick's own stdout can never name the same item differently.
   */
  subject: string;
  turn: string | null;
  outcome: OperationOutcome;
  detail: string;
  /** True only when the executor was actually invoked — what decides work-log membership. */
  ranExecutor: boolean;
  executor?: string;
  model?: string;
  effort?: string;
}

export interface TickLog {
  command: string;
  /** `owner/name`, or null when the slug could not be resolved. */
  repo: string | null;
  timestamp: Date;
  durationMs: number;
  exitCode: number;
  /** A short marker for an invocation that ran no tick, e.g. "lock-held". */
  note?: string;
  items: TickLogItem[];
}

/**
 * Where the logs live: the parent of the working directory.
 *
 * Not configurable, and deliberately so — one workspace root collects the logs
 * of every checkout beneath it, and the repository slug on each entry keeps
 * them apart.
 */
export function operationLogDirectory(): string {
  return dirname(process.cwd());
}

/** `-` rather than an empty field, so a line always has the same shape. */
function repoField(repo: string | null): string {
  if (repo === null) return "-";
  const flat = oneLine(repo);
  return flat.length === 0 ? "-" : flat;
}

/**
 * One tick as one greppable line.
 *
 * Every outcome bucket is emitted even at zero: an absent key would be
 * ambiguous between "none of those" and "written by an older automata", which
 * is the same reason `summarize()` names the executor unconditionally.
 */
export function formatExecutionLine(tick: TickLog): string {
  const counts: Record<OperationOutcome, number> = {
    answered: 0,
    "answered-no-reply": 0,
    skipped: 0,
    failed: 0,
    deferred: 0,
  };
  let runs = 0;
  for (const item of tick.items) {
    counts[item.outcome]++;
    if (item.ranExecutor) runs++;
  }

  const fields = [
    tick.timestamp.toISOString(),
    tick.command,
    `repo=${repoField(tick.repo)}`,
    `items=${String(tick.items.length)}`,
    ...OUTCOMES.map((outcome) => `${outcome}=${String(counts[outcome])}`),
    `runs=${String(runs)}`,
    `exit=${String(tick.exitCode)}`,
    `dur=${(tick.durationMs / 1000).toFixed(1)}s`,
  ];
  if (tick.note !== undefined && tick.note.length > 0) fields.push(`note=${tick.note}`);
  return fields.join(" ") + "\n";
}

/**
 * Collapse a value to a single line.
 *
 * Every field interpolated into a log line goes through this, not just the
 * detail. A newline in any of them would not merely split one item across two
 * lines: a fragment starting `=== <token> ` matches `RECORD_HEADER`, so the
 * next prune reads it as a record boundary, dates the remainder from the
 * injected timestamp and can delete half of a legitimate record. `model` and
 * `effort` come straight from `.automata/config.json` and are never validated
 * for this, so the guarantee has to be enforced here.
 */
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** A newline inside a detail would split one item across two lines. */
function briefDetail(detail: string): string {
  const flat = oneLine(detail);
  return flat.length <= MAX_DETAIL_LENGTH ? flat : `${flat.slice(0, MAX_DETAIL_LENGTH)}…`;
}

function describeItemExecution(item: TickLogItem): string {
  if (item.executor === undefined) return "";
  const model = item.model === undefined ? "" : ` model=${oneLine(item.model)}`;
  const effort = item.effort === undefined ? "" : ` effort=${oneLine(item.effort)}`;
  return ` [${oneLine(item.executor)}${model}${effort}]`;
}

/**
 * The record for one tick, or null when the tick performed nothing.
 *
 * "Performed something" means the executor was actually invoked for at least
 * one item, which is the definition the run cap already uses — so the work log
 * and `--max-runs` can never disagree about whether a tick did work.
 */
export function formatWorkRecord(tick: TickLog): string | null {
  const ran = tick.items.filter((item) => item.ranExecutor);
  if (ran.length === 0) return null;

  const header = `=== ${tick.timestamp.toISOString()} ${repoField(tick.repo)} ===\n`;
  const lines = ran.map(
    (item) =>
      `${oneLine(item.subject)} ${item.turn === null ? "-" : oneLine(item.turn)} ${item.outcome}` +
      `${describeItemExecution(item)} — ${briefDetail(item.detail)}\n`,
  );
  return header + lines.join("") + "\n";
}

/**
 * Keep the newest `max` lines. A trailing newline terminates the last line
 * rather than starting an empty one, so it must not be counted.
 */
export function trimToLastLines(content: string, max: number): string {
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length <= max) return content;
  return lines.slice(lines.length - max).join("\n") + "\n";
}

const RECORD_HEADER = /^=== (\S+) /;

/**
 * Drop records older than the cut-off, keeping anything that is not a datable
 * record.
 *
 * A record whose header timestamp does not parse is kept: this function must
 * never throw, and silently deleting content automata cannot interpret would
 * turn a formatting bug into data loss. Text before the first header — a
 * hand-written note, a truncated write — is preserved verbatim for the same
 * reason.
 */
export function pruneOldRecords(content: string, now: Date, maxAgeMs: number): string {
  if (content.length === 0) return content;
  const cutoff = now.getTime() - maxAgeMs;

  // Group the file into a preamble plus one group per `=== ` header. Each
  // group owns the blank separator line below it, so dropping a record takes
  // its separator with it and the survivors keep theirs.
  interface Group {
    /** null for the text before the first header, which is always kept. */
    header: string | null;
    lines: string[];
  }
  const lines = content.split("\n");
  // The file's terminating newline produces a final empty element that belongs
  // to no line; re-added below, once, when each group is written back.
  if (lines.at(-1) === "") lines.pop();

  const groups: Group[] = [];
  let current: Group = { header: null, lines: [] };
  for (const line of lines) {
    const header = RECORD_HEADER.exec(line);
    if (header === null) {
      current.lines.push(line);
      continue;
    }
    groups.push(current);
    current = { header: header[1], lines: [line] };
  }
  groups.push(current);

  return groups
    .filter((group) => {
      if (group.lines.length === 0) return false;
      if (group.header === null) return true;
      const parsed = Date.parse(group.header);
      // An undatable record is kept: this must never throw, and silently
      // deleting content automata cannot interpret would turn a formatting bug
      // into data loss.
      // `>=`, not `>`: the rule is "more than 30 days old", so a record landing
      // exactly on the cut-off is still inside the window and survives.
      return Number.isNaN(parsed) || parsed >= cutoff;
    })
    .map((group) => group.lines.join("\n") + "\n")
    .join("");
}

/**
 * Append, then apply retention.
 *
 * In this order because the newest entry is the one most likely to matter and
 * must survive a failed rewrite — and because the common path then stays a
 * single `O_APPEND` write, which is atomic for a short line.
 *
 * The rewrite, by contrast, is read-modify-write and *can* lose a line that
 * another checkout appends inside the window. That is accepted rather than
 * fixed — see "Known limits" in `docs/do-work.md`. Taking a lock to protect a
 * diagnostic file would mean a log that can block the tick it describes, which
 * is a worse failure than a dropped line in a file that is already lossy by
 * construction.
 *
 * The rewrite goes through a temp file and `renameSync` so a reader never sees
 * a half-written log, matching what `runLock.ts` does for the same reason —
 * including the `randomUUID()` name and the `finally` cleanup, so a failed
 * rename cannot leave a `.tmp` file behind in the user's workspace root.
 */
function appendWithRetention(
  dir: string,
  file: string,
  content: string,
  retain: (existing: string) => string,
): void {
  const target = join(dir, file);
  appendFileSync(target, content, "utf8");

  const existing = readFileSync(target, "utf8");
  const retained = retain(existing);
  if (retained === existing) return;

  // A pid is unique only within one host, and this directory is shared by
  // design — possibly across containers mounting the same workspace root.
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, retained, "utf8");
    renameSync(temp, target);
  } finally {
    // Nothing else ever collects these, and the name is different every tick,
    // so a leak here accumulates for good.
    try {
      unlinkSync(temp);
    } catch {
      // The rename consumed it, which is the successful path.
    }
  }
}

/**
 * Record one `do-work` invocation. The only function here that touches disk.
 *
 * Silent on every failure, by design: the issue asks for the files to be
 * ignored when they cannot be written, and a warning on every tick of a
 * five-minute cron in a read-only workspace would be noise in exactly the
 * output this log exists to replace.
 */
export function recordTick(tick: TickLog, dir: string = operationLogDirectory()): void {
  try {
    // The cheap path for a deliberately locked-down parent: no file is created
    // and no error is allocated. It is advisory only — foreign file ownership,
    // a full disk or a remount are all still possible, which is what the
    // per-file catches below are for.
    accessSync(dir, constants.W_OK);
  } catch {
    return;
  }

  // One try per file, not one around both. The pre-check tests the *directory*,
  // so it cannot see a single log file that has become unwritable on its own —
  // the realistic case being one `do-work` run as root, or as another container
  // UID, leaving `automata-execution.log` owned by someone else. A shared catch
  // would let that one file take the other permanently down with it.
  try {
    appendWithRetention(dir, EXECUTION_LOG_FILE, formatExecutionLine(tick), (existing) =>
      trimToLastLines(existing, MAX_EXECUTION_LINES),
    );
  } catch {
    // Diagnostics must never take down the tick they are describing.
  }

  try {
    const record = formatWorkRecord(tick);
    if (record === null) return;
    const maxAgeMs = WORK_RECORD_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    appendWithRetention(dir, WORK_LOG_FILE, record, (existing) =>
      pruneOldRecords(existing, tick.timestamp, maxAgeMs),
    );
  } catch {
    // As above.
  }
}
