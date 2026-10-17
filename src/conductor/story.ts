import type { IssueDiscoveryTechnique } from "../config/configStore.js";
import { BLOCKED_LABEL } from "./loopSafety.js";

/**
 * Pure rules for a story: a parent issue whose children the conductor starts one
 * at a time. The caller reads the children and the open pull requests; nothing here runs `gh`.
 */

/** A child issue as the conductor read it. */
export interface StoryChild {
  number: number;
  title: string;
  state: "open" | "closed";
  labels: string[];
  assignees: string[];
  /** Numbers of the open pull requests that close this child. */
  openPrs: number[];
}

export type ChildStatus = "closed" | "blocked" | "in-review" | "started" | "next" | "queued";

export type StoryAction = "start" | "wait" | "blocked" | "complete" | "empty";

export interface StoryPlan {
  action: StoryAction;
  /** The first open child; null when the action is `complete` or `empty`. */
  current: StoryChild | null;
  /** One status per child, in the order of `children`. */
  statuses: ChildStatus[];
}

export interface Discovery {
  technique: IssueDiscoveryTechnique;
  value: string;
}

/**
 * The child numbers in a task list: `- [ ] #12` and `- [x] https://github.com/o/r/issues/12`.
 * First occurrence wins; a link to another repository is not a child.
 */
export function parseTaskList(body: string, repo: { owner: string; repo: string }): number[] {
  const seen = new Set<number>();
  const url = `https://github.com/${repo.owner}/${repo.repo}/issues/`.toLowerCase();
  for (const line of body.split(/\r?\n/)) {
    const item = /^\s*[-*]\s+\[[ xX]\]\s+(\S+)/.exec(line);
    if (item === null) continue;
    const ref = item[1].replace(/[.,;:)]+$/, "");
    const short = /^#(\d+)$/.exec(ref);
    const full = ref.toLowerCase().startsWith(url) ? /^(\d+)$/.exec(ref.slice(url.length)) : null;
    const digits = (short ?? full)?.[1];
    if (digits === undefined) continue;
    const value = Number(digits);
    if (Number.isSafeInteger(value) && value > 0) seen.add(value);
  }
  return [...seen];
}

function isStarted(child: StoryChild, discovery: Discovery): boolean {
  if (discovery.technique === "label") return child.labels.includes(discovery.value);
  if (discovery.technique === "assignee") return child.assignees.includes(discovery.value);
  return false;
}

/** What a tick does for the story, and the status of every child. */
export function planStory(children: StoryChild[], discovery: Discovery): StoryPlan {
  const index = children.findIndex((child) => child.state === "open");
  if (children.length === 0) return { action: "empty", current: null, statuses: [] };
  if (index === -1) return { action: "complete", current: null, statuses: children.map(() => "closed") };
  const current = children[index];
  let status: ChildStatus = "next";
  if (current.labels.includes(BLOCKED_LABEL)) status = "blocked";
  else if (current.openPrs.length > 0) status = "in-review";
  else if (isStarted(current, discovery)) status = "started";
  let action: StoryAction = "wait";
  if (status === "blocked") action = "blocked";
  else if (status === "next") action = "start";
  return {
    action,
    current,
    statuses: children.map((_, i) => {
      if (i < index) return "closed";
      return i === index ? status : "queued";
    }),
  };
}

/** One line for a child, for `conductor list`. */
export function describeChild(child: StoryChild, status: ChildStatus): string {
  const detail: Record<ChildStatus, string> = {
    closed: "closed",
    blocked: `blocked (${BLOCKED_LABEL})`,
    "in-review": `in review (PR ${child.openPrs.map((n) => `#${String(n)}`).join(", ")})`,
    started: "started, waiting for a pull request",
    next: "next",
    queued: "queued",
  };
  return `#${String(child.number)} ${detail[status]}: ${child.title}`;
}

/** The comment that closes a finished story. */
export function storyDoneComment(children: StoryChild[]): string {
  const list = children.map((child) => `- #${String(child.number)} ${child.title}`).join("\n");
  return `All ${String(children.length)} child issues are closed, so the conductor closes this story.\n\n${list}`;
}

/** The state of a story as text lines: a summary of what a tick does, then one line per child. */
export function storyLines(plan: StoryPlan, children: StoryChild[]): string[] {
  const current = plan.current;
  const name = current === null ? "" : `child #${String(current.number)}`;
  const waitsFor = plan.statuses.includes("started") ? "do-work has not opened a pull request yet" : "its pull request is not merged yet";
  const summary: Record<StoryAction, string> = {
    start: `${name} is next; a tick starts it`,
    wait: `${name} is waiting: ${waitsFor}`,
    blocked: `${name} is blocked; the story is stopped until a person removes the ${BLOCKED_LABEL} label`,
    complete: "all children are closed; a tick closes the story",
    empty: "no children are left to read; a tick does nothing",
  };
  return [summary[plan.action], ...children.map((child, i) => `  ${describeChild(child, plan.statuses[i])}`)];
}
