import type { ExecutionTick, LogReadResult, WorkRecord } from "./operationLog.js";
import type { LockStatus } from "./runLock.js";
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
  problems: string[],
  data: Record<string, unknown>,
): CheckSection {
  return {
    id,
    title: SECTION_TITLES[id],
    lines,
    problems: problems.map((summary) => ({ section: id, summary })),
    data,
  };
}

/* ------------------------------ lock ------------------------------------- */

function describeOwner(owner: {
  pid: number;
  host: string;
  command: string;
  startedAt: string;
}): string {
  return `pid ${String(owner.pid)} on ${owner.host}, \`${owner.command}\`, since ${owner.startedAt}`;
}

/**
 * A *live* lock is not a problem.
 *
 * The shell script in issue #75 treats any running `do-work` as a failure, which
 * is wrong for a scheduled loop: a tick in flight when the check runs is the
 * normal case. Only a lock nothing is behind — or one whose holder cannot be
 * identified after the staleness window — stops future ticks.
 */
export function lockSection(status: LockStatus, staleMinutes: number): CheckSection {
  const data: Record<string, unknown> = { status: status.kind, staleMinutes };

  switch (status.kind) {
    case "free":
      return build("lock", ["no tick is running in this checkout"], [], data);

    case "held": {
      const held =
        status.heldForMs === null ? "" : ` (${describeDuration(status.heldForMs)} so far)`;
      return build("lock", [`a tick is running: ${describeOwner(status.owner)}${held}`], [], {
        ...data,
        owner: status.owner,
        heldForMs: status.heldForMs,
      });
    }

    case "suspect": {
      const held = status.heldForMs === null ? "unknown" : describeDuration(status.heldForMs);
      return build(
        "lock",
        [`a tick has held the lock for ${held}: ${describeOwner(status.owner)}`],
        [
          `the run lock has been held longer than ${String(staleMinutes)} minutes by a process whose identity ` +
            "cannot be verified; if no executor is running, kill the holder or delete `.automata/automata.lock`",
        ],
        { ...data, owner: status.owner, heldForMs: status.heldForMs },
      );
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
          "a stale run lock is present; the next tick reclaims it automatically, so no action is needed unless ticks keep being turned away",
        ],
        { ...data, owner: status.owner, heldForMs: status.heldForMs },
      );

    case "unreadable":
      return build(
        "lock",
        [`the run lock could not be read: ${status.detail}`],
        [`the run lock at \`.automata/automata.lock\` could not be read: ${status.detail}`],
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

/** Why the log has nothing to say; null when it does. */
function describeMissingTicks(
  read: LogReadResult<ExecutionTick>,
): { line: string; problem: string } | null {
  if (read.error !== null) {
    return {
      line: `the execution log could not be read: ${read.error}`,
      problem: `the execution log \`${read.path}\` could not be read: ${read.error}`,
    };
  }
  if (!read.present) {
    return {
      line: `no execution log at ${read.path}`,
      problem:
        `no execution log at \`${read.path}\` — no tick has ever run here, or automata cannot write to the ` +
        "workspace root; check that the scheduler runs `do-work` from inside the checkout",
    };
  }
  if (read.entries.length === 0) {
    return {
      line: "the execution log holds no tick for this repository",
      problem:
        "the execution log holds no tick for this repository — the scheduler has never successfully run `do-work` here",
    };
  }
  return null;
}

/** The newest tick, the shape of the history behind it, and the cadence it implies. */
function describeTickHistory(
  ticks: ExecutionTick[],
  cadence: TickCadence,
  now: Date,
  lines: string[],
  problems: string[],
): void {
  lines.push(`last tick: ${describeTick(ticks[0], now)}`);
  if (ticks[0].exitCode !== 0) {
    problems.push(
      `the last tick exited ${String(ticks[0].exitCode)} — see \`Last work\` below and the work log for the item that failed`,
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
      "every recorded tick was turned away by a held run lock — a previous tick is wedged; see `Run lock` above",
    );
  }

  if (cadence.medianIntervalMs === null) {
    lines.push("cadence: not enough history to judge whether the scheduler is still firing");
    return;
  }
  lines.push(`cadence: about one tick every ${describeDuration(cadence.medianIntervalMs)}`);
  if (cadence.silent) {
    problems.push(
      `no tick for ${describeDuration(cadence.sinceNewestMs ?? 0)}, against a usual interval of ` +
        `${describeDuration(cadence.medianIntervalMs)} — the scheduler appears to have stopped firing ` +
        "(automata does not manage the scheduler; check it on this host)",
    );
  }
}

export function tickSection(read: LogReadResult<ExecutionTick>, now: Date): CheckSection {
  const lines: string[] = [];
  const problems: string[] = [];
  const ticks = read.entries;
  const cadence = tickCadence(ticks, now);

  const missing = describeMissingTicks(read);
  if (missing !== null) {
    lines.push(missing.line);
    problems.push(missing.problem);
  } else {
    describeTickHistory(ticks, cadence, now, lines, problems);
  }

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
    logPath: read.path,
    logPresent: read.present,
  });
}

/* ------------------------------ work ------------------------------------- */

/**
 * An empty work log is not a problem on its own: a loop with nothing to answer
 * legitimately invokes no executor for days. The *ticks* section is what notices
 * a loop that has stopped.
 */
export function workSection(read: LogReadResult<WorkRecord>, now: Date): CheckSection {
  const lines: string[] = [];
  const problems: string[] = [];
  const records = read.entries;

  if (read.error !== null) {
    lines.push(`the work log could not be read: ${read.error}`);
    problems.push(`the work log \`${read.path}\` could not be read: ${read.error}`);
  } else if (!read.present || records.length === 0) {
    lines.push("no tick has invoked the executor in the retained window");
  } else {
    for (const record of records) {
      const age = describeDuration(now.getTime() - record.timestamp.getTime());
      lines.push(`${record.timestamp.toISOString()} (${age} ago)`);
      for (const item of record.items) {
        const how =
          item.executor === null
            ? ""
            : ` [${[item.executor, item.model, item.effort].filter((part) => part !== null).join(" ")}]`;
        // The synchronisation strategy is reported because a branch that stops
        // synchronising is otherwise indistinguishable from one with nothing to do.
        const sync = item.sync === null ? "" : ` sync=${item.sync}`;
        lines.push(
          `  ${item.subject} ${item.turn ?? "-"} ${item.outcome}${how}${sync} — ${item.detail}`,
        );
      }
    }
  }

  if (read.skipped > 0)
    lines.push(`${String(read.skipped)} log line(s) could not be parsed and were ignored`);
  if (read.otherRepos > 0)
    lines.push(`${String(read.otherRepos)} record(s) belonged to another repository`);

  return build("work", lines, problems, {
    records,
    skipped: read.skipped,
    otherRepos: read.otherRepos,
    logPath: read.path,
    logPresent: read.present,
  });
}

/* ------------------------------- git ------------------------------------- */

/** Where HEAD is, and whether the tree under it is clean. */
function describeCheckout(status: RepoStatus, lines: string[], problems: string[]): void {
  if (status.branch === null) {
    lines.push(`HEAD is detached at ${status.head ?? "an unknown commit"}`);
    problems.push("HEAD is detached; the pre-flight expects a branch, so check one out");
  } else {
    const at = status.head === null ? "" : ` at ${status.head}`;
    lines.push(`on ${status.branch}${at}`);
  }

  if (status.dirtyPaths.length === 0) {
    lines.push("working tree is clean");
    return;
  }
  lines.push(`working tree has ${String(status.dirtyPaths.length)} uncommitted change(s):`);
  for (const path of status.dirtyPaths) lines.push(`  ${path}`);
  problems.push(
    `the working tree has ${String(status.dirtyPaths.length)} uncommitted change(s); the pre-flight will try to ` +
      "rescue them onto a branch, and every item skips as `dirty-tree` if that fails",
  );
}

/** The base branch against its upstream: present, tracked, and fast-forwardable? */
function describeBaseBranch(status: RepoStatus, lines: string[], problems: string[]): void {
  if (!status.baseLocal) {
    lines.push(`base branch ${status.baseBranch} does not exist in this checkout`);
    problems.push(
      `the base branch \`${status.baseBranch}\` does not exist locally; either check it out or correct ` +
        "`doWork.baseBranch` with `automata config set do-work-base-branch <branch>`",
    );
    return;
  }
  if (status.upstream === null) {
    lines.push(`base branch ${status.baseBranch} has no upstream`);
    problems.push(
      `the base branch \`${status.baseBranch}\` has no upstream, so the pre-flight cannot fast-forward it`,
    );
    return;
  }

  const freshness = status.refreshed ? "" : " (not refreshed)";
  const ahead = status.ahead === null ? "?" : String(status.ahead);
  const behind = status.behind === null ? "?" : String(status.behind);
  lines.push(
    `base branch ${status.baseBranch} vs ${status.upstream}: ahead ${ahead}, behind ${behind}${freshness}`,
  );

  if (status.ahead === null || status.ahead === 0) return;
  if (status.behind !== null && status.behind > 0) {
    problems.push(
      `the base branch \`${status.baseBranch}\` has diverged from ${status.upstream} ` +
        `(${String(status.ahead)} ahead, ${String(status.behind)} behind); the pre-flight's fast-forward pull ` +
        "will fail until that is resolved by hand",
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
  const problems: string[] = [];

  if (status.error !== null) {
    return build(
      "git",
      [`not a usable git repository: ${status.error}`],
      [`not a usable git repository: ${status.error}`],
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
      `\`git fetch\` failed (${status.fetchError}); the ahead/behind figures above are from the last ` +
        "successful fetch and may be out of date",
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
  };
}

export function renderText(report: CheckReport): string {
  const head = `automata do-work --check — ${report.repo ?? "unknown repository"} — ${report.generatedAt.toISOString()}`;
  const parts: string[] = [head, ""];

  for (const section of report.sections) {
    parts.push(section.title);
    if (section.lines.length === 0) {
      parts.push("  (nothing to report)");
    } else {
      for (const line of section.lines) parts.push(`  ${line}`);
    }
    parts.push("");
  }

  if (report.problems.length > 0) {
    parts.push(`Problems (${String(report.problems.length)})`);
    for (const problem of report.problems) parts.push(`  · ${problem.section}: ${problem.summary}`);
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
  };
}
