import type { ExecutionTick, LogDirectoryStatus, LogReadResult, WorkRecord } from "./operationLog.js";
import type { LockStatus } from "./runLock.js";
import type { Heartbeat } from "./heartbeat.js";
import { describeTracedCommand, type TracedCommand } from "./commandTrace.js";
import type { RepoStatus } from "../git/repoStatus.js";

/**
 * The model behind `do-work --check`.
 *
 * Everything here is a pure function over values the collectors produced, so
 * every acceptance scenario in the spec is a unit test that needs no git, no
 * `gh` and no filesystem. The command module supplies the two sections that
 * cannot be pure — the live GitHub selection and the environment — as ready-made
 * `CheckSection`s.
 */

export type SectionId = "lock" | "ticks" | "work" | "git" | "selection" | "environment";

export interface Problem {
  section: SectionId;
  /** One line, in the operator's words: what is wrong and, where there is one, the fix. */
  summary: string;
  /**
   * One command that investigates this finding further, or null.
   *
   * Null is a real answer, not a gap: a scheduler that has stopped firing is a
   * property of the host's cron and no automata command says anything about it.
   * Printing a plausible-looking command there would send an operator down a
   * path that cannot answer the question, which is worse than printing nothing.
   */
  command: string | null;
}

/** A problem before it knows which section raised it. */
interface Finding {
  summary: string;
  command: string | null;
}

/** `finding("…", "git status")` — the shape every section builds its problems from. */
function finding(summary: string, command: string | null): Finding {
  return { summary, command };
}

export interface CheckSection {
  id: SectionId;
  title: string;
  /** The findings, already phrased for a terminal. */
  lines: string[];
  problems: Problem[];
  /** The same facts as data, for `--json`. */
  data: Record<string, unknown>;
}

export interface CheckReport {
  generatedAt: Date;
  repo: string | null;
  /** True when `--no-fetch` suppressed every network call. */
  offline: boolean;
  sections: CheckSection[];
  problems: Problem[];
  exitCode: 0 | 1;
  /**
   * The `--verbose` command trace; null when tracing was off.
   *
   * Deliberately not a seventh `CheckSection`: it raises no problems — it is
   * evidence, not a finding — and `SECTION_ORDER` is the contract the check's
   * six sections are pinned by.
   */
  trace: TracedCommand[] | null;
  /**
   * What blocked the tick, when this report is a blocked dump rather than a
   * `--check` run. Null for `--check`.
   */
  blocked: BlockedHeader | null;
}

/** The trigger line a blocked dump is headed by. */
export interface BlockedHeader {
  /** The machine-readable reason, e.g. `lock-held`. */
  reason: string;
  /** One sentence in the operator's words, e.g. `run lock held by pid 851554 on cisharpai`. */
  trigger: string;
}

/** The report order. Fixed, and every section is printed even when it found nothing. */
export const SECTION_ORDER: readonly SectionId[] = [
  "lock",
  "ticks",
  "work",
  "git",
  "selection",
  "environment",
];

const SECTION_TITLES: Record<SectionId, string> = {
  lock: "Run lock",
  ticks: "Recent ticks",
  work: "Last work",
  git: "Repository",
  selection: "Selection",
  environment: "Environment",
};

export function sectionTitle(id: SectionId): string {
  return SECTION_TITLES[id];
}

/** How many recent ticks the report shows, and how many work records. */
export const TICK_HISTORY = 20;
export const WORK_HISTORY = 3;

/**
 * How many times the median tick interval may elapse before the scheduler is
 * presumed to have stopped.
 *
 * Three tolerates one tick that overran its slot plus one that was skipped
 * outright, which is the noise a busy host produces, while still catching a cron
 * that is no longer firing at all.
 */
export const SILENCE_MULTIPLIER = 3;

/**
 * Intervals needed before the cadence is trusted. Two ticks give one interval,
 * which any single delay distorts; three intervals give a median that survives
 * one outlier — and stop a day-old installation reporting a failure.
 */
export const MIN_INTERVALS = 3;

export interface TickCadence {
  /** Null when fewer than `MIN_INTERVALS` intervals are available. */
  medianIntervalMs: number | null;
  /** Null when no tick has ever been recorded. */
  sinceNewestMs: number | null;
  silent: boolean;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Has the scheduler stopped firing?
 *
 * Answered from the log rather than from configuration: the cron interval
 * belongs to the host and automata is deliberately not told it, but the recorded
 * ticks *are* a record of it. The median is used rather than the mean so that
 * one past outage — a machine that was off for a week — cannot inflate the
 * expectation far enough to mask an outage happening right now.
 *
 * `ticks` must be newest-first, as both log readers return them.
 */
export function tickCadence(ticks: ExecutionTick[], now: Date): TickCadence {
  if (ticks.length === 0) return { medianIntervalMs: null, sinceNewestMs: null, silent: false };

  const sinceNewestMs = now.getTime() - ticks[0].timestamp.getTime();

  const intervals: number[] = [];
  for (let i = 0; i + 1 < ticks.length; i++) {
    const gap = ticks[i].timestamp.getTime() - ticks[i + 1].timestamp.getTime();
    // A non-positive gap means two ticks share a timestamp or the log is out of
    // order; either way it says nothing about the cadence.
    if (gap > 0) intervals.push(gap);
  }
  if (intervals.length < MIN_INTERVALS)
    return { medianIntervalMs: null, sinceNewestMs, silent: false };

  const medianIntervalMs = median(intervals);
  return {
    medianIntervalMs,
    sinceNewestMs,
    silent: sinceNewestMs > SILENCE_MULTIPLIER * medianIntervalMs,
  };
}

/** A duration a human reads at a glance: `4m`, `2h 10m`, `3d 4h`. */
export function describeDuration(ms: number): string {
  if (ms < 0) return "in the future";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ${String(minutes % 60)}m`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d ${String(hours % 24)}h`;
}

function build(
  id: SectionId,
  lines: string[],
  problems: Finding[],
  data: Record<string, unknown>,
): CheckSection {
  return {
    id,
    title: SECTION_TITLES[id],
    lines,
    problems: problems.map((item) => ({ section: id, ...item })),
    data,
  };
}

/* ------------------------------ lock ------------------------------------- */

/**
 * What the checking process is, so the report can compare itself with the lock's
 * holder rather than describe it in isolation.
 */
export interface LockContext {
  /** The checking process's working directory. */
  cwd: string;
  /** The operation-log directory that working directory implies. */
  logDirectory: string;
  /** `dirname`, supplied by the caller so this module stays free of `node:path`. */
  parentOf: (dir: string) => string;
}

function describeOwner(owner: {
  pid: number;
  host: string;
  command: string;
  startedAt: string;
}): string {
  return `pid ${String(owner.pid)} on ${owner.host}, \`${owner.command}\`, since ${owner.startedAt}`;
}

/**
 * Where the holder runs from, and — when that is not where this check is
 * running from — where each of the two therefore reads and writes its logs.
 *
 * This is the line that closes issue #82. The operation log lives in
 * `dirname(cwd)`, so a tick the scheduler fires from a different directory logs
 * somewhere the operator is not looking, and the only visible symptom is a live
 * lock beside an empty log. Stating both derivations turns that contradiction
 * into one sentence.
 *
 * A lock written by an older automata has no recorded directory. That is
 * reported as unknown and raises nothing: absence is a version marker here, not
 * a fault.
 */
function describeOwnerLocation(
  owner: { cwd?: string },
  context: LockContext,
  lines: string[],
  problems: Finding[],
): void {
  if (owner.cwd === undefined) {
    lines.push("  working directory: not recorded (lock written by an older automata)");
    return;
  }
  lines.push(`  working directory: ${owner.cwd}`);
  if (owner.cwd === context.cwd) return;

  const ownerLogs = context.parentOf(owner.cwd);
  lines.push(`  logs to ${ownerLogs} (this check reads ${context.logDirectory})`);
  problems.push(
    finding(
      `the tick holding the lock runs from \`${owner.cwd}\` and writes its operation logs to ` +
        `\`${ownerLogs}\`, while this check reads \`${context.logDirectory}\` — the two will not agree ` +
        "about what has run; run the check from the directory the scheduler uses",
      `ls -l ${ownerLogs}/automata-execution.log`,
    ),
  );
}

/**
 * The live tick's own account of itself: phase, item, executor.
 *
 * Rendered with the age of the last update rather than its timestamp, because
 * the question being asked is "is it still moving?" — and a heartbeat that
 * stopped advancing is the one signal that distinguishes a slow tick from a
 * wedged one.
 */
function describeHeartbeat(
  heartbeat: Heartbeat | null | undefined,
  now: Date,
  lines: string[],
): void {
  if (heartbeat === undefined || heartbeat === null) {
    lines.push("  phase: not reported (no heartbeat from this holder)");
    return;
  }

  const updated = Date.parse(heartbeat.updatedAt);
  const age = Number.isNaN(updated) ? "unknown" : `${describeDuration(now.getTime() - updated)} ago`;
  const item =
    heartbeat.item === null
      ? ""
      : ` — item ${String(heartbeat.item.index)} of ${String(heartbeat.item.total)}, ${heartbeat.item.subject}`;
  lines.push(`  phase: ${heartbeat.phase}${item} (updated ${age})`);

  if (heartbeat.executor === null) return;
  const started = Date.parse(heartbeat.executor.startedAt);
  const running = Number.isNaN(started)
    ? `since ${heartbeat.executor.startedAt}`
    : `running for ${describeDuration(now.getTime() - started)}`;
  lines.push(`  executor: ${heartbeat.executor.command}, ${running}`);
}

/**
 * A *live* lock is not a problem.
 *
 * The shell script in issue #75 treats any running `do-work` as a failure, which
 * is wrong for a scheduled loop: a tick in flight when the check runs is the
 * normal case. Only a lock nothing is behind — or one whose holder cannot be
 * identified after the staleness window — stops future ticks.
 */
export function lockSection(
  status: LockStatus,
  staleMinutes: number,
  context: LockContext,
  now: Date = new Date(),
): CheckSection {
  const data: Record<string, unknown> = {
    status: status.kind,
    staleMinutes,
    cwd: context.cwd,
    logDirectory: context.logDirectory,
  };

  switch (status.kind) {
    case "free":
      return build("lock", ["no tick is running in this checkout"], [], data);

    case "held": {
      const held =
        status.heldForMs === null ? "" : ` (${describeDuration(status.heldForMs)} so far)`;
      const lines = [`a tick is running: ${describeOwner(status.owner)}${held}`];
      const problems: Finding[] = [];
      describeOwnerLocation(status.owner, context, lines, problems);
      describeHeartbeat(status.heartbeat, now, lines);
      return build("lock", lines, problems, {
        ...data,
        owner: status.owner,
        heldForMs: status.heldForMs,
        heartbeat: status.heartbeat ?? null,
      });
    }

    case "suspect": {
      const held = status.heldForMs === null ? "unknown" : describeDuration(status.heldForMs);
      const lines = [`a tick has held the lock for ${held}: ${describeOwner(status.owner)}`];
      const problems: Finding[] = [];
      describeOwnerLocation(status.owner, context, lines, problems);
      describeHeartbeat(status.heartbeat, now, lines);
      // Pushed after the location finding so the report reads in the order the
      // lines above do.
      problems.push(
        finding(
          `the run lock has been held longer than ${String(staleMinutes)} minutes by a process whose identity ` +
            "cannot be verified; if no executor is running, kill the holder or delete `.automata/automata.lock`",
          `ps -p ${String(status.owner.pid)} -o pid,lstart,args`,
        ),
      );
      return build("lock", lines, problems, {
        ...data,
        owner: status.owner,
        heldForMs: status.heldForMs,
        heartbeat: status.heartbeat ?? null,
      });
    }

    case "stale":
      return build(
        "lock",
        [
          status.owner === null
            ? "a run lock exists but could not be parsed"
            : `a stale run lock is present: ${describeOwner(status.owner)}`,
        ],
        [
          finding(
            "a stale run lock is present; the next tick reclaims it automatically, so no action is needed unless ticks keep being turned away",
            "cat .automata/automata.lock",
          ),
        ],
        { ...data, owner: status.owner, heldForMs: status.heldForMs },
      );

    case "unreadable":
      return build(
        "lock",
        [`the run lock could not be read: ${status.detail}`],
        [
          finding(
            `the run lock at \`.automata/automata.lock\` could not be read: ${status.detail}`,
            "ls -l .automata/automata.lock",
          ),
        ],
        { ...data, detail: status.detail },
      );
  }
}

/* ------------------------------ ticks ------------------------------------ */

function describeTick(tick: ExecutionTick, now: Date): string {
  const counts = [
    `answered=${String(tick.counts.answered)}`,
    `no-reply=${String(tick.counts["answered-no-reply"])}`,
    `skipped=${String(tick.counts.skipped)}`,
    `failed=${String(tick.counts.failed)}`,
    `deferred=${String(tick.counts.deferred)}`,
    `runs=${String(tick.runs)}`,
  ].join(" ");
  const note = tick.note === null ? "" : ` note=${tick.note}`;
  const age = describeDuration(now.getTime() - tick.timestamp.getTime());
  return `${tick.timestamp.toISOString()} (${age} ago) exit=${String(tick.exitCode)} ${counts}${note}`;
}

/**
 * Why the log has nothing to say; null when it does.
 *
 * `explained` marks the two cases a *live* tick accounts for: `recordTick` runs
 * when a tick ends, so a first-ever tick still in flight legitimately has
 * nothing in the log yet. Reporting that as a fault is the contradiction issue
 * #82 pasted — a running pid beside "no tick has ever run here". An unreadable
 * log is not marked, because a live tick explains an empty file and says nothing
 * at all about a permissions failure.
 */
function describeMissingTicks(
  read: LogReadResult<ExecutionTick>,
): { line: string; problem: Finding; explainedByLiveTick: boolean } | null {
  if (read.error !== null) {
    return {
      line: `the execution log could not be read: ${read.error}`,
      problem: finding(
        `the execution log \`${read.path}\` could not be read: ${read.error}`,
        `ls -l ${read.path}`,
      ),
      explainedByLiveTick: false,
    };
  }
  if (!read.present) {
    return {
      line: `no execution log at ${read.path}`,
      problem: finding(
        `no execution log at \`${read.path}\` — no tick has ever run here, or automata cannot write to the ` +
          "workspace root; check that the scheduler runs `do-work` from inside the checkout",
        `ls -la ${read.path}`,
      ),
      explainedByLiveTick: true,
    };
  }
  if (read.entries.length === 0) {
    return {
      line: "the execution log holds no tick for this repository",
      problem: finding(
        "the execution log holds no tick for this repository — the scheduler has never successfully run `do-work` here",
        `tail -5 ${read.path}`,
      ),
      explainedByLiveTick: true,
    };
  }
  return null;
}

/**
 * The log directory, its derivation and whether a tick could write there —
 * printed on every run, not only when something is missing.
 *
 * The path was always available on `LogReadResult.path`; what was missing was
 * where it came from. `dirname(process.cwd())` moves with whoever launched the
 * process, so an operator reading a path they do not recognise had no way to
 * tell a misconfigured scheduler from an empty history.
 */
function describeLogDirectory(
  directory: LogDirectoryStatus,
  lines: string[],
  problems: Finding[],
): void {
  const writable = directory.writable ? "writable" : `not writable: ${directory.detail ?? "unknown"}`;
  lines.push(
    `log directory: ${directory.dir} (the parent of the working directory ${directory.cwd}), ${writable}`,
  );
  if (directory.writable) return;
  problems.push(
    finding(
      `the operation log directory \`${directory.dir}\` is not writable (${directory.detail ?? "unknown"}), so ` +
        "every tick records nothing and this report can only ever be blank; make it writable by the account " +
        "the scheduler runs as",
      `ls -ld ${directory.dir}`,
    ),
  );
}

/** The newest tick, the shape of the history behind it, and the cadence it implies. */
function describeTickHistory(
  ticks: ExecutionTick[],
  cadence: TickCadence,
  now: Date,
  logPath: string,
  lines: string[],
  problems: Finding[],
): void {
  lines.push(`last tick: ${describeTick(ticks[0], now)}`);
  if (ticks[0].exitCode !== 0) {
    problems.push(
      finding(
        `the last tick exited ${String(ticks[0].exitCode)} — see \`Last work\` below and the work log for the item that failed`,
        "automata do-work --check --verbose",
      ),
    );
  }

  const lockHeld = ticks.filter((tick) => tick.note === "lock-held").length;
  const withRuns = ticks.filter((tick) => tick.runs > 0).length;
  lines.push(
    `history: ${String(ticks.length)} tick(s), ${String(withRuns)} invoked the executor, ` +
      `${String(lockHeld)} were turned away by a held lock`,
  );
  if (lockHeld === ticks.length && ticks.length > 1) {
    problems.push(
      finding(
        "every recorded tick was turned away by a held run lock — a previous tick is wedged; see `Run lock` above",
        "cat .automata/automata.lock",
      ),
    );
  }

  if (cadence.medianIntervalMs === null) {
    lines.push("cadence: not enough history to judge whether the scheduler is still firing");
    return;
  }
  lines.push(`cadence: about one tick every ${describeDuration(cadence.medianIntervalMs)}`);
  if (cadence.silent) {
    problems.push(
      finding(
        `no tick for ${describeDuration(cadence.sinceNewestMs ?? 0)}, against a usual interval of ` +
          `${describeDuration(cadence.medianIntervalMs)} — the scheduler appears to have stopped firing ` +
          "(automata does not manage the scheduler; check it on this host)",
        // The log's own tail is the only thing automata can offer: the
        // scheduler belongs to the host, and naming a `crontab -l` here would
        // be a guess about how this installation is driven.
        `tail -5 ${logPath}`,
      ),
    );
  }
}

/**
 * Said whenever the repository slug could not be resolved, because the reader
 * then keeps every checkout's entries. Without it the section presents another
 * repository's history as this one's, which is exactly the wrong answer for an
 * operator asking why *this* checkout has done nothing.
 */
function unfilteredLine(unit: string): string {
  return `not filtered by repository: the slug could not be resolved, so ${unit} from other checkouts may be shown`;
}

/**
 * The tick history, and the two facts that explain an empty one.
 *
 * `lockStatus` is here for a cross-section judgement rather than for display:
 * "no tick has ever been recorded" is a fault when nothing is running and the
 * expected state when a first tick is still in flight, and the report has both
 * facts in hand. Deciding it inside this section is what stops the two halves
 * of the report contradicting each other.
 */
export function tickSection(
  read: LogReadResult<ExecutionTick>,
  now: Date,
  directory: LogDirectoryStatus,
  lockStatus: LockStatus,
): CheckSection {
  const lines: string[] = [];
  const problems: Finding[] = [];
  const ticks = read.entries;
  const cadence = tickCadence(ticks, now);
  const tickInFlight = lockStatus.kind === "held" || lockStatus.kind === "suspect";

  describeLogDirectory(directory, lines, problems);

  const missing = describeMissingTicks(read);
  if (missing !== null) {
    lines.push(missing.line);
    if (tickInFlight && missing.explainedByLiveTick) {
      lines.push(
        "a tick is running and has not recorded itself yet — the log is written when a tick ends, " +
          "so this is the expected state for a first tick still in flight",
      );
    } else {
      problems.push(missing.problem);
    }
  } else {
    describeTickHistory(ticks, cadence, now, read.path, lines, problems);
  }

  if (!read.filtered && read.present) lines.push(unfilteredLine("line(s)"));
  if (read.skipped > 0)
    lines.push(`${String(read.skipped)} log line(s) could not be parsed and were ignored`);
  if (read.otherRepos > 0)
    lines.push(`${String(read.otherRepos)} line(s) belonged to another repository`);

  return build("ticks", lines, problems, {
    newest: ticks[0] ?? null,
    history: ticks,
    lockHeldCount: ticks.filter((tick) => tick.note === "lock-held").length,
    medianIntervalMs: cadence.medianIntervalMs,
    sinceNewestMs: cadence.sinceNewestMs,
    silent: cadence.silent,
    skipped: read.skipped,
    otherRepos: read.otherRepos,
    filtered: read.filtered,
    logPath: read.path,
    logPresent: read.present,
    logDirectory: directory,
    tickInFlight,
  });
}

/* ------------------------------ work ------------------------------------- */

/**
 * An empty work log is not a problem on its own: a loop with nothing to answer
 * legitimately invokes no executor for days. The *ticks* section is what notices
 * a loop that has stopped.
 */
/**
 * One item line, in the shape `operationLog` wrote it.
 *
 * The synchronisation strategy is reported because a branch that stops
 * synchronising is otherwise indistinguishable from one with nothing to do.
 */
function describeWorkItem(item: WorkRecord["items"][number]): string {
  const how =
    item.executor === null
      ? ""
      : ` [${[item.executor, item.model, item.effort].filter((part) => part !== null).join(" ")}]`;
  const sync = item.sync === null ? "" : ` sync=${item.sync}`;
  return `  ${item.subject} ${item.turn ?? "-"} ${item.outcome}${how}${sync} — ${item.detail}`;
}

/** Each retained record, newest first, with its age. */
function describeWorkRecords(records: WorkRecord[], now: Date): string[] {
  return records.flatMap((record) => [
    `${record.timestamp.toISOString()} (${describeDuration(now.getTime() - record.timestamp.getTime())} ago)`,
    ...record.items.map(describeWorkItem),
  ]);
}

export function workSection(read: LogReadResult<WorkRecord>, now: Date): CheckSection {
  const lines: string[] = [];
  const problems: Finding[] = [];
  const records = read.entries;

  if (read.error !== null) {
    lines.push(`the work log could not be read: ${read.error}`);
    problems.push(
      finding(`the work log \`${read.path}\` could not be read: ${read.error}`, `ls -l ${read.path}`),
    );
  } else if (!read.present || records.length === 0) {
    lines.push("no tick has invoked the executor in the retained window");
  } else {
    lines.push(...describeWorkRecords(records, now));
  }

  if (!read.filtered && read.present) lines.push(unfilteredLine("record(s)"));

  if (read.skipped > 0)
    lines.push(`${String(read.skipped)} log line(s) could not be parsed and were ignored`);
  if (read.otherRepos > 0)
    lines.push(`${String(read.otherRepos)} record(s) belonged to another repository`);

  return build("work", lines, problems, {
    records,
    skipped: read.skipped,
    otherRepos: read.otherRepos,
    filtered: read.filtered,
    logPath: read.path,
    logPresent: read.present,
  });
}

/* ------------------------------- git ------------------------------------- */

/** Where HEAD is, and whether the tree under it is clean. */
function describeCheckout(status: RepoStatus, lines: string[], problems: Finding[]): void {
  if (status.branch === null) {
    lines.push(`HEAD is detached at ${status.head ?? "an unknown commit"}`);
    problems.push(
      finding(
        "HEAD is detached; the pre-flight expects a branch, so check one out",
        "git status --short --branch",
      ),
    );
  } else {
    const at = status.head === null ? "" : ` at ${status.head}`;
    lines.push(`on ${status.branch}${at}`);
  }

  if (status.statusError !== null) {
    lines.push(`the working tree could not be inspected: ${status.statusError}`);
    problems.push(
      finding(
        `\`git status\` failed (${status.statusError}), so whether the working tree is clean is unknown; ` +
          "the pre-flight runs the same command and stops every item when it cannot answer",
        "git status --porcelain",
      ),
    );
    return;
  }

  if (status.dirtyPaths.length === 0) {
    lines.push("working tree is clean");
    return;
  }
  lines.push(`working tree has ${String(status.dirtyPaths.length)} uncommitted change(s):`);
  for (const path of status.dirtyPaths) lines.push(`  ${path}`);
  problems.push(
    finding(
      `the working tree has ${String(status.dirtyPaths.length)} uncommitted change(s); the pre-flight will try to ` +
        "rescue them onto a branch, and every item skips as `dirty-tree` if that fails",
      "git status --porcelain",
    ),
  );
}

/** The base branch against its upstream: present, tracked, and fast-forwardable? */
function describeBaseBranch(status: RepoStatus, lines: string[], problems: Finding[]): void {
  if (!status.baseLocal) {
    lines.push(`base branch ${status.baseBranch} does not exist in this checkout`);
    problems.push(
      finding(
        `the base branch \`${status.baseBranch}\` does not exist locally; either check it out or correct ` +
          "`doWork.baseBranch` with `automata config set do-work-base-branch <branch>`",
        "git branch --list --all",
      ),
    );
    return;
  }
  if (status.upstream === null) {
    lines.push(`base branch ${status.baseBranch} has no upstream`);
    problems.push(
      finding(
        `the base branch \`${status.baseBranch}\` has no upstream, so the pre-flight cannot fast-forward it`,
        `git branch -vv --list ${status.baseBranch}`,
      ),
    );
    return;
  }

  // An inferred `origin/<base>` is not tracking configuration. The pre-flight's
  // bare `git pull --ff-only` reads the branch's own configuration and fails
  // without it, however healthy the counts below look.
  if (!status.upstreamTracked) {
    lines.push(
      `base branch ${status.baseBranch} has no tracking configuration; counted against ${status.upstream}`,
    );
    problems.push(
      finding(
        `the base branch \`${status.baseBranch}\` has no upstream configured, so the pre-flight's ` +
          `\`git pull --ff-only\` fails even though ${status.upstream} exists; set it with ` +
          `\`git branch --set-upstream-to=${status.upstream} ${status.baseBranch}\``,
        `git branch -vv --list ${status.baseBranch}`,
      ),
    );
  }

  const freshness = status.refreshed ? "" : " (not refreshed)";
  const ahead = status.ahead === null ? "?" : String(status.ahead);
  const behind = status.behind === null ? "?" : String(status.behind);
  lines.push(
    `base branch ${status.baseBranch} vs ${status.upstream}: ahead ${ahead}, behind ${behind}${freshness}`,
  );

  // Both counts null with the branch and its upstream both present means
  // `rev-list` failed or answered something unreadable. Returning quietly here
  // would let a checkout whose state was never established exit `0`.
  if (status.ahead === null || status.behind === null) {
    problems.push(
      finding(
        `the divergence of \`${status.baseBranch}\` from ${status.upstream} could not be read, so whether the ` +
          "pre-flight's fast-forward pull will succeed is unknown; try `git rev-list --left-right --count " +
          `${status.upstream}...${status.baseBranch}\` to see git's own error`,
        `git rev-list --left-right --count ${status.upstream}...${status.baseBranch}`,
      ),
    );
    return;
  }

  if (status.ahead === 0) return;
  if (status.behind > 0) {
    problems.push(
      finding(
        `the base branch \`${status.baseBranch}\` has diverged from ${status.upstream} ` +
          `(${String(status.ahead)} ahead, ${String(status.behind)} behind); the pre-flight's fast-forward pull ` +
          "will fail until that is resolved by hand",
        `git log --oneline --left-right ${status.upstream}...${status.baseBranch}`,
      ),
    );
    return;
  }
  // Ahead-only is reported but not a problem: a fast-forward pull succeeds,
  // and unpushed commits on the base branch are the operator's business.
  lines.push(`  ${String(status.ahead)} local commit(s) not on ${status.upstream}`);
}

/**
 * The checkout, judged by what would stop a tick.
 *
 * "Not on the base branch" is deliberately *not* a problem: the pre-flight
 * checks the base branch out itself, so a checkout left on a feature branch is
 * the normal state between ticks. A dirty tree and a diverged base branch are,
 * because the first makes every item skip and the second makes the pre-flight's
 * fast-forward pull fail.
 */
export function gitSection(status: RepoStatus): CheckSection {
  const lines: string[] = [];
  const problems: Finding[] = [];

  if (status.error !== null) {
    return build(
      "git",
      [`not a usable git repository: ${status.error}`],
      [finding(`not a usable git repository: ${status.error}`, "git rev-parse --is-inside-work-tree")],
      {
        ...status,
      },
    );
  }

  describeCheckout(status, lines, problems);
  describeBaseBranch(status, lines, problems);

  if (status.fetchError !== null) {
    lines.push(`fetch failed: ${status.fetchError}`);
    problems.push(
      finding(
        `\`git fetch\` failed (${status.fetchError}); the ahead/behind figures above are from the last ` +
          "successful fetch and may be out of date",
        "git fetch origin",
      ),
    );
  }

  return build("git", lines, problems, { ...status });
}

/* ----------------------------- assembly ---------------------------------- */

export function assembleReport(input: {
  generatedAt: Date;
  repo: string | null;
  offline: boolean;
  sections: CheckSection[];
  trace?: TracedCommand[] | null;
  blocked?: BlockedHeader | null;
}): CheckReport {
  const byId = new Map(input.sections.map((section) => [section.id, section]));
  const ordered = SECTION_ORDER.flatMap((id) => {
    const section = byId.get(id);
    return section === undefined ? [] : [section];
  });
  const problems = ordered.flatMap((section) => section.problems);
  return {
    generatedAt: input.generatedAt,
    repo: input.repo,
    offline: input.offline,
    sections: ordered,
    problems,
    exitCode: problems.length === 0 ? 0 : 1,
    trace: input.trace ?? null,
    blocked: input.blocked ?? null,
  };
}

export function renderText(report: CheckReport): string {
  const head = `automata do-work --check — ${report.repo ?? "unknown repository"} — ${report.generatedAt.toISOString()}`;
  // The trigger goes above the header, not in place of it: an operator scrolling
  // a cron log needs the first line to say why this appeared, and the header
  // still has to name the repository and the moment.
  const parts: string[] =
    report.blocked === null ? [head, ""] : [`blocked: ${report.blocked.trigger}`, head, ""];

  for (const section of report.sections) {
    parts.push(section.title);
    if (section.lines.length === 0) {
      parts.push("  (nothing to report)");
    } else {
      for (const line of section.lines) parts.push(`  ${line}`);
    }
    parts.push("");
  }

  if (report.trace !== null) {
    parts.push(`Commands (${String(report.trace.length)})`);
    if (report.trace.length === 0) {
      parts.push("  (no git or gh command was run)");
    } else {
      for (const traced of report.trace) parts.push(`  ${describeTracedCommand(traced)}`);
    }
    parts.push("");
  }

  if (report.problems.length > 0) {
    parts.push(`Problems (${String(report.problems.length)})`);
    for (const problem of report.problems) {
      parts.push(`  · ${problem.section}: ${problem.summary}`);
      if (problem.command !== null) parts.push(`      try: ${problem.command}`);
    }
    parts.push("");
  }

  parts.push(
    report.problems.length === 0
      ? "RESULT: healthy"
      : `RESULT: ${String(report.problems.length)} problem(s) found`,
  );
  return parts.join("\n") + "\n";
}

export function toJson(report: CheckReport): Record<string, unknown> {
  const sections: Record<string, unknown> = {};
  for (const section of report.sections) {
    sections[section.id] = {
      title: section.title,
      lines: section.lines,
      problems: section.problems,
      data: section.data,
    };
  }
  return {
    generatedAt: report.generatedAt.toISOString(),
    repo: report.repo,
    offline: report.offline,
    exitCode: report.exitCode,
    problems: report.problems,
    sections,
    trace: report.trace,
    blocked: report.blocked,
  };
}
