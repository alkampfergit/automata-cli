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
  /**
   * How the item's branch was synchronised with the remote, or why it was not:
   * the strategy on a success, the failure reason on a refusal.
   *
   * Recorded because a cron tick discards its stdout, and a branch that stops
   * synchronising is otherwise indistinguishable from a branch with nothing to
   * do — which is what made the `pull-failed` loop in issue #73 invisible.
   */
  sync?: string;
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
/**
 * The synchronisation strategies that carry no information: a branch that
 * fast-forwarded, or one this checkout had never seen before. Everything else —
 * a reset, a rebase, a refusal — is worth a field.
 */
const QUIET_SYNC: ReadonlySet<string> = new Set(["fast-forward", "tracking-branch"]);

/**
 * `rebase:1,pull-failed:2`, or null when nothing unusual happened.
 *
 * Null rather than an empty field so the line of an ordinary tick is byte-for-
 * byte what it was before this existed, and an existing grep keeps working.
 */
function summarizeSync(items: readonly TickLogItem[]): string | null {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.sync === undefined) continue;
    const key = oneLine(item.sync);
    if (key.length === 0 || QUIET_SYNC.has(key)) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  return [...counts].map(([strategy, count]) => `${strategy}:${String(count)}`).join(",");
}

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
  const sync = summarizeSync(tick.items);
  if (sync !== null) fields.push(`sync=${sync}`);
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

/** Every ran item names its strategy, including the ordinary one — the work log is read per item. */
function describeItemSync(item: TickLogItem): string {
  if (item.sync === undefined) return "";
  const flat = oneLine(item.sync);
  return flat.length === 0 ? "" : ` sync=${flat}`;
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
      `${describeItemExecution(item)}${describeItemSync(item)} — ${briefDetail(item.detail)}\n`,
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

/* ------------------------------------------------------------------------- *
 * The read side.
 *
 * Kept in this module rather than in a reader of its own so that one file owns
 * both halves of each format: the round-trip tests drive the formatters above
 * into the parsers below, and a renamed field cannot pass them.
 *
 * Every parser here is total. These files are shared between checkouts, trimmed
 * in place and occasionally hand-edited, so a line that does not fit the format
 * is skipped and counted — never thrown over, which would make one bad line hide
 * the whole history it sits in.
 * ------------------------------------------------------------------------- */

/** One parsed line of the execution log. */
export interface ExecutionTick {
  timestamp: Date;
  command: string;
  /** `owner/name`; null for the `-` the writer emits when the slug was unresolvable. */
  repo: string | null;
  items: number;
  counts: Record<OperationOutcome, number>;
  runs: number;
  exitCode: number;
  durationSeconds: number;
  note: string | null;
}

export interface WorkRecordItem {
  subject: string;
  turn: string | null;
  outcome: OperationOutcome;
  executor: string | null;
  model: string | null;
  effort: string | null;
  /** The `sync=` field when the writer emitted one; null when the branch needed nothing unusual. */
  sync: string | null;
  detail: string;
}

/** One `=== <iso> <slug> ===` block of the work log. */
export interface WorkRecord {
  timestamp: Date;
  repo: string | null;
  items: WorkRecordItem[];
}

export interface LogReadOptions {
  /** Keep only entries for this slug. Undefined keeps every entry. */
  repo?: string | null;
  /** Newest-first cap. Undefined keeps all. */
  limit?: number;
  dir?: string;
}

export interface LogReadResult<T> {
  entries: T[];
  /** True when the file exists and could be read, whatever it contained. */
  present: boolean;
  /** Set when the file exists but could not be read. */
  error: string | null;
  /** Entries that did not fit the format. */
  skipped: number;
  /** Well-formed entries belonging to a different repository. */
  otherRepos: number;
  /**
   * False when no repository filter was applied, which happens when the caller
   * could not resolve its own slug. The entries then come from every checkout
   * that shares the log, and a report must say so rather than present them as
   * this repository's history.
   */
  filtered: boolean;
  path: string;
}

function isOutcome(value: string): value is OperationOutcome {
  return (OUTCOMES as readonly string[]).includes(value);
}

/** Read a log file, distinguishing "absent" from "unreadable" — they mean different things. */
function readLogFile(path: string): { content: string | null; error: string | null } {
  try {
    return { content: readFileSync(path, "utf8"), error: null };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { content: null, error: null };
    return { content: null, error: (err as Error).message };
  }
}

function emptyResult<T>(path: string, error: string | null, filtered: boolean): LogReadResult<T> {
  return { entries: [], present: false, error, skipped: 0, otherRepos: 0, filtered, path };
}

/** Whether a repository filter was asked for at all. */
function isFiltered(want: string | null | undefined): boolean {
  return want !== undefined && want !== null;
}

/**
 * Apply the repository filter.
 *
 * A null `repo` on the *entry* means the writer could not resolve its slug, and
 * such an entry is kept whatever the filter: excluding it would hide precisely
 * the ticks that ran in a checkout with a broken remote, which is a fault worth
 * reporting rather than one worth hiding.
 */
function matchesRepo(entryRepo: string | null, want: string | null | undefined): boolean {
  if (want === undefined || want === null) return true;
  return entryRepo === null || entryRepo === want;
}

/**
 * A numeric log field, parsed whole.
 *
 * Absent means "written by an older automata" and reads as zero; present but
 * unparseable means the line is corrupt and voids it. `Number.parseInt` alone
 * cannot tell those apart — it accepts `42junk` and, through `|| 0`, turned
 * `items=oops` into a clean zero-item tick, hiding damaged history behind a
 * healthy report.
 */
function readInt(value: string | undefined): number | null {
  if (value === undefined) return 0;
  if (!/^-?\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * As `readInt`, for the one fractional field. `formatExecutionLine` writes the
 * duration with its unit (`dur=1.5s`), which is accepted here and nowhere else.
 */
function readDurationSeconds(value: string | undefined): number | null {
  if (value === undefined) return 0;
  if (!/^\d+(?:\.\d+)?s?$/.test(value)) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseExecutionLine(line: string): ExecutionTick | null {
  const fields = line
    .trim()
    .split(" ")
    .filter((field) => field.length > 0);
  if (fields.length < 2) return null;

  const timestamp = new Date(fields[0]);
  if (Number.isNaN(timestamp.getTime())) return null;

  const pairs = new Map<string, string>();
  for (const field of fields.slice(2)) {
    const eq = field.indexOf("=");
    if (eq <= 0) continue;
    pairs.set(field.slice(0, eq), field.slice(eq + 1));
  }

  // `exit` is the one field with no sensible default: a line without it was not
  // written by `formatExecutionLine` and guessing 0 would report a failed tick
  // as clean.
  const exit = readInt(pairs.get("exit"));
  if (exit === null) return null;

  const counts = {} as Record<OperationOutcome, number>;
  for (const outcome of OUTCOMES) {
    const count = readInt(pairs.get(outcome));
    if (count === null) return null;
    counts[outcome] = count;
  }

  const items = readInt(pairs.get("items"));
  const runs = readInt(pairs.get("runs"));
  const durationSeconds = readDurationSeconds(pairs.get("dur"));
  if (items === null || runs === null || durationSeconds === null) return null;

  const repo = pairs.get("repo");
  const note = pairs.get("note");
  return {
    timestamp,
    command: fields[1],
    repo: repo === undefined || repo === "-" ? null : repo,
    items,
    counts,
    runs,
    exitCode: exit,
    durationSeconds,
    note: note === undefined || note.length === 0 ? null : note,
  };
}

/**
 * The execution log, newest first.
 *
 * Newest first because every consumer wants the last tick, and reversing at the
 * reader means the `limit` cap keeps the *recent* history rather than the
 * oldest lines still in the file.
 */
export function readExecutionTicks(options: LogReadOptions = {}): LogReadResult<ExecutionTick> {
  const path = join(options.dir ?? operationLogDirectory(), EXECUTION_LOG_FILE);
  const { content, error } = readLogFile(path);
  if (content === null) return emptyResult(path, error, isFiltered(options.repo));

  const entries: ExecutionTick[] = [];
  let skipped = 0;
  let otherRepos = 0;
  for (const line of content.split("\n")) {
    if (line.trim().length === 0) continue;
    const tick = parseExecutionLine(line);
    if (tick === null) {
      skipped++;
      continue;
    }
    if (!matchesRepo(tick.repo, options.repo)) {
      otherRepos++;
      continue;
    }
    entries.push(tick);
  }

  entries.reverse();
  return {
    entries: options.limit === undefined ? entries : entries.slice(0, options.limit),
    present: true,
    error: null,
    skipped,
    otherRepos,
    filtered: isFiltered(options.repo),
    path,
  };
}

/**
 * `#42` / `PR #61` / `#?`, then the turn, then the outcome, then an optional
 * `[executor model=… effort=…]`, then an optional `sync=…`, then the detail
 * after an em dash.
 *
 * Anchored on the outcome rather than on field positions: the subject is one or
 * two tokens depending on whether the item had an issue, so counting from the
 * left would mis-split every `pr-orphan` record.
 *
 * The `sync=` group is lazy so a value holding a space still stops at the em
 * dash. It has to be matched rather than tolerated: an unmatched line is
 * counted as skipped, which would have dropped from the report exactly the
 * items whose branch needed more than a fast-forward.
 */
const WORK_ITEM_LINE =
  /^(#\S+|PR #\S+) (\S+) (answered-no-reply|answered|skipped|failed|deferred)(?: \[([^\]]*)\])?(?: sync=(.*?))? — (.*)$/;

function parseExecution(
  bracket: string | undefined,
): Pick<WorkRecordItem, "executor" | "model" | "effort"> {
  if (bracket === undefined) return { executor: null, model: null, effort: null };
  const parts = bracket.split(" ").filter((part) => part.length > 0);
  const executor = parts[0] ?? null;
  const find = (key: string): string | null => {
    const hit = parts.find((part) => part.startsWith(`${key}=`));
    return hit === undefined ? null : hit.slice(key.length + 1);
  };
  return { executor, model: find("model"), effort: find("effort") };
}

/**
 * A `=== <iso> <slug> ===` record header.
 *
 * Three outcomes, kept distinct because the caller treats them differently: the
 * sentinel `"not-a-header"` means the line is an item and should be parsed as
 * one, `null` means it *is* a header but its timestamp is unreadable, and a
 * record means a new one has started.
 */
function parseWorkHeader(line: string): WorkRecord | null | "not-a-header" {
  const header = /^=== (\S+) (\S+) ===$/.exec(line);
  if (header === null) return "not-a-header";
  const timestamp = new Date(header[1]);
  if (Number.isNaN(timestamp.getTime())) return null;
  return { timestamp, repo: header[2] === "-" ? null : header[2], items: [] };
}

/** One item line under a record header; null when it does not parse. */
function parseWorkItem(line: string): WorkRecord["items"][number] | null {
  const item = WORK_ITEM_LINE.exec(line);
  if (item === null) return null;
  return {
    subject: item[1],
    turn: item[2] === "-" ? null : item[2],
    // The alternation in the pattern admits nothing else.
    outcome: isOutcome(item[3]) ? item[3] : "skipped",
    ...parseExecution(item[4]),
    sync: item[5] === undefined || item[5].length === 0 ? null : item[5],
    detail: item[6],
  };
}

/**
 * The work log, newest record first.
 *
 * A record is a `=== <iso> <slug> ===` header and the item lines under it. Text
 * before the first header, and any line inside a record that does not parse, is
 * counted as skipped — `pruneOldRecords` deliberately preserves both, so a
 * reader meets them.
 */
export function readWorkRecords(options: LogReadOptions = {}): LogReadResult<WorkRecord> {
  const path = join(options.dir ?? operationLogDirectory(), WORK_LOG_FILE);
  const { content, error } = readLogFile(path);
  if (content === null) return emptyResult(path, error, isFiltered(options.repo));

  const entries: WorkRecord[] = [];
  let skipped = 0;
  let otherRepos = 0;
  let current: WorkRecord | null = null;

  const close = (): void => {
    if (current === null) return;
    if (matchesRepo(current.repo, options.repo)) {
      entries.push(current);
    } else {
      otherRepos++;
    }
    current = null;
  };

  for (const line of content.split("\n")) {
    if (line.trim().length === 0) continue;

    const header = parseWorkHeader(line);
    if (header === null) {
      // A header whose timestamp is unreadable is counted and stepped over. It
      // must not close the record in progress: doing so orphaned every item line
      // after it, so one damaged line hid the work history that followed it.
      skipped++;
      continue;
    }
    if (header !== "not-a-header") {
      close();
      current = header;
      continue;
    }

    const item = parseWorkItem(line);
    if (item === null || current === null) {
      skipped++;
      continue;
    }
    current.items.push(item);
  }
  close();

  entries.reverse();
  return {
    entries: options.limit === undefined ? entries : entries.slice(0, options.limit),
    present: true,
    error: null,
    skipped,
    otherRepos,
    filtered: isFiltered(options.repo),
    path,
  };
}
