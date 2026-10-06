import { describeDuration } from "../run/checkReport.js";
import type { LockStatus } from "../run/runLock.js";
import type { ConductorDecision } from "./replyDecision.js";

/**
 * Pure report for `conductor --check`: what a tick would do now, built from facts
 * the caller has read. It has the shape of the `do-work --check` report (titled
 * sections, a Problems list, a RESULT line, exit 0/1) but its own sections,
 * because the conductor has no ticks log, no git state and no selection.
 */

export interface Problem {
  section: string;
  summary: string;
}

export interface CheckSection {
  title: string;
  lines: string[];
  problems: Problem[];
}

/** One watched id as the check read it. */
export type WatchedCheck =
  | { id: number; kind: "issue" | "pr"; state: "open" | "closed"; decisions: ConductorDecision[]; coveredBy?: number }
  | { id: number; unavailable: string };

export interface ConductorCheckInput {
  generatedAt: Date;
  repo: string | null;
  /** The first configuration problem; when set, the other facts were not read. */
  configProblem: string | null;
  identity: string;
  execution: string;
  lock: LockStatus;
  staleMinutes: number;
  watched: WatchedCheck[];
}

export interface ConductorCheck {
  text: string;
  exitCode: 0 | 1;
  problems: Problem[];
}

function section(title: string, lines: string[], problems: Problem[] = []): CheckSection {
  return { title, lines, problems };
}

function label(id: number, kind: "issue" | "pr"): string {
  return `${kind === "pr" ? "PR" : "issue"} #${String(id)}`;
}

export function lockSection(status: LockStatus, staleMinutes: number): CheckSection {
  const fix = "remove .automata/conductor.lock once you have confirmed that no conductor runs";
  switch (status.kind) {
    case "free":
      return section("Run lock", ["no conductor is running in this checkout"]);
    case "held": {
      const held = status.heldForMs === null ? "" : ` (${describeDuration(status.heldForMs)} so far)`;
      return section("Run lock", [
        `a conductor is running: pid ${String(status.owner.pid)} on ${status.owner.host}, started ${status.owner.startedAt}${held}`,
        "a tick started now would do nothing",
      ]);
    }
    case "suspect":
      return section(
        "Run lock",
        [`held longer than ${String(staleMinutes)} minutes by pid ${String(status.owner.pid)} on ${status.owner.host}`],
        [{ section: "lock", summary: `the lock looks alive but outlived the stale window, probably a reused pid: ${fix}` }],
      );
    case "stale":
      return section("Run lock", ["a stale lock is present; the next tick takes it over"]);
    case "unreadable":
      return section(
        "Run lock",
        [`the lock cannot be read: ${status.detail}`],
        [{ section: "lock", summary: `the lock file cannot be read (${status.detail}); fix its permissions` }],
      );
  }
}

function decisionLine(decision: ConductorDecision): string {
  const where = label(decision.surface.number, decision.surface.kind);
  return decision.kind === "reply"
    ? `reply on ${where}: ${decision.reason}`
    : `skip ${where} (${decision.reason}): ${decision.detail}`;
}

export function watchSections(watched: WatchedCheck[]): CheckSection[] {
  const listLines: string[] = [];
  const replyLines: string[] = [];
  const problems: Problem[] = [];
  for (const entry of watched) {
    if ("unavailable" in entry) {
      listLines.push(`#${String(entry.id)}: unavailable (${entry.unavailable}); a tick keeps it and skips it`);
      problems.push({ section: "watch", summary: `#${String(entry.id)} could not be read: ${entry.unavailable}` });
      continue;
    }
    const name = label(entry.id, entry.kind);
    if (entry.state === "closed") {
      listLines.push(`${name}: closed, a tick would drop it from the watch list`);
      continue;
    }
    if (entry.coveredBy !== undefined) {
      listLines.push(`${name}: open, covered by watched issue #${String(entry.coveredBy)}; a tick gives it no separate reply`);
      continue;
    }
    listLines.push(`${name}: open`);
    for (const decision of entry.decisions) replyLines.push(decisionLine(decision));
  }
  return [
    section(`Watch list (${String(watched.length)})`, listLines, problems),
    section("Replies a tick would write", replyLines),
  ];
}

export function buildConductorCheck(input: ConductorCheckInput): ConductorCheck {
  const sections: CheckSection[] =
    input.configProblem === null
      ? [
          section("Configuration", [`running as ${input.identity}`, `executor: ${input.execution}`]),
          lockSection(input.lock, input.staleMinutes),
          ...watchSections(input.watched),
        ]
      : [
          section(
            "Configuration",
            [input.configProblem],
            [{ section: "configuration", summary: input.configProblem }],
          ),
        ];

  const problems = sections.flatMap((s) => s.problems);
  const parts = [
    `automata conductor --check — ${input.repo ?? "unknown repository"} — ${input.generatedAt.toISOString()}`,
    "",
  ];
  for (const s of sections) {
    parts.push(s.title, ...(s.lines.length === 0 ? ["(nothing to report)"] : s.lines).map((l) => `  ${l}`), "");
  }
  if (problems.length > 0) {
    parts.push(`Problems (${String(problems.length)})`, ...problems.map((p) => `  · ${p.section}: ${p.summary}`), "");
  }
  parts.push(problems.length === 0 ? "RESULT: healthy" : `RESULT: ${String(problems.length)} problem(s) found`);
  return { text: parts.join("\n") + "\n", exitCode: problems.length === 0 ? 0 : 1, problems };
}
