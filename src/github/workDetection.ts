import type { TurnKind } from "../config/configStore.js";
import type { GitHubIssue } from "../config/githubService.js";
import {
  analyzeSurface,
  lastAuthorClass,
  type Participants,
  type RawMessage,
  type SurfaceAnalysis,
} from "./conversation.js";
import type { IssueSurface, MarkerRef, PrSurface, PullRequestRef, ReviewThread } from "./ghWorkService.js";

/**
 * The turn decision: given everything known about one issue, does the agent owe
 * an answer, and of what kind?
 *
 * Pure by design. This is the state machine of the autonomous loop, so it is
 * kept free of I/O to be exhaustively testable without a `gh` binary.
 */

export interface IssueState {
  issueSurface: IssueSurface;
  /** Every open pull request that declares a closing reference to this issue. */
  linkedPrs: PullRequestRef[];
  /** Fetched only when an open linked pull request exists. */
  prSurface: PrSurface | null;
}

export type SkipReason = "issue-closed" | "no-new-messages";

export interface WorkItem {
  issue: GitHubIssue;
  turn: TurnKind;
  pr: PullRequestRef | null;
  /** Base branch for a discuss turn, the pull request's head branch for a build turn. */
  branch: string;
  /** True when the agent is not yet among the issue's assignees. */
  needsAssignment: boolean;
  issueAnalysis: SurfaceAnalysis;
  prAnalysis: SurfaceAnalysis | null;
  actionableThreads: ReviewThread[];
  /** Human-readable justification, printed in the work plan. */
  reason: string;
  /** Non-empty when several open pull requests close this issue. */
  ambiguousPrs: PullRequestRef[];
}

export type Decision =
  | { kind: "work"; item: WorkItem }
  | { kind: "skip"; issue: GitHubIssue; reason: SkipReason; detail: string };

function isAssignedToAgent(assignees: string[], agentUser: string): boolean {
  const agent = agentUser.toLowerCase();
  return assignees.some((name) => name.toLowerCase() === agent);
}

/**
 * Threads that still need an answer: unresolved, and with an authorized human as
 * the newest commenter.
 *
 * The agent having spoken last means the thread is answered even while it is
 * still unresolved — resolving is the reviewer's action, so treating unresolved
 * as actionable would retrigger the same thread on every tick forever.
 */
function findActionableThreads(threads: ReviewThread[], p: Participants): ReviewThread[] {
  return threads.filter(
    (thread) => !thread.isResolved && lastAuthorClass(thread.comments, p) === "authorized",
  );
}

function newestPr(prs: PullRequestRef[]): PullRequestRef {
  return [...prs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

export function decideWork(state: IssueState, p: Participants, baseBranch: string): Decision {
  const { issueSurface, prSurface } = state;
  const issue = issueSurface.issue;

  if (issueSurface.state === "CLOSED") {
    return { kind: "skip", issue, reason: "issue-closed", detail: "the issue is closed" };
  }

  const issueAnalysis = analyzeSurface(issueSurface.messages, p);
  const needsAssignment = !isAssignedToAgent(issueSurface.assignees, p.agentUser);

  // A merged or closed pull request is treated as no pull request: its branch has
  // landed or gone, so the model must not push to it. A discuss turn lets the
  // humans say what comes next.
  const openPrs = state.linkedPrs.filter((pr) => pr.state === "OPEN");
  const hasOpenPr = openPrs.length > 0 && prSurface !== null && prSurface.pr.state === "OPEN";

  if (!hasOpenPr) {
    if (!issueAnalysis.hasNewMessage) {
      return {
        kind: "skip",
        issue,
        reason: "no-new-messages",
        detail:
          issueAnalysis.lastAgentAt === null
            ? "no messages from authorized accounts"
            : `nothing new since the agent's message at ${issueAnalysis.lastAgentAt}`,
      };
    }
    return {
      kind: "work",
      item: {
        issue,
        turn: "issue-discuss",
        pr: null,
        branch: baseBranch,
        needsAssignment,
        issueAnalysis,
        prAnalysis: null,
        actionableThreads: [],
        reason: `${plural(issueAnalysis.newMessageCount, "new issue message")}, no open pull request`,
        ambiguousPrs: [],
      },
    };
  }

  const surface = prSurface;
  const prAnalysis = analyzeSurface(surface.messages, p);
  const actionableThreads = findActionableThreads(surface.threads, p);
  const hasPrWork = prAnalysis.hasNewMessage || actionableThreads.length > 0;

  if (!hasPrWork && !issueAnalysis.hasNewMessage) {
    return {
      kind: "skip",
      issue,
      reason: "no-new-messages",
      detail: `nothing new on issue or pull request #${String(surface.pr.number)}`,
    };
  }

  const reasons: string[] = [];
  if (prAnalysis.hasNewMessage) {
    reasons.push(plural(prAnalysis.newMessageCount, "new pull request message"));
  }
  if (actionableThreads.length > 0) {
    reasons.push(plural(actionableThreads.length, "unresolved review thread"));
  }
  if (issueAnalysis.hasNewMessage) {
    reasons.push(plural(issueAnalysis.newMessageCount, "new issue message"));
  }

  return {
    kind: "work",
    item: {
      issue,
      turn: "pr-work",
      pr: surface.pr,
      branch: surface.pr.headRefName,
      needsAssignment,
      issueAnalysis,
      prAnalysis,
      actionableThreads,
      reason: `${reasons.join(", ")} on pull request #${String(surface.pr.number)}`,
      // Several open PRs closing one issue is ambiguous rather than wrong; the
      // most recently updated one is used and the rest are reported.
      ambiguousPrs: openPrs.length > 1 ? openPrs.filter((pr) => pr.number !== surface.pr.number) : [],
    },
  };
}

/** Pick the pull request to work on when an issue has several open linked ones. */
export function selectLinkedPr(linkedPrs: PullRequestRef[]): PullRequestRef | null {
  const open = linkedPrs.filter((pr) => pr.state === "OPEN");
  return open.length === 0 ? null : newestPr(open);
}

/**
 * Did the model post its own answer after the marker was placed?
 *
 * Established by re-reading the surface, never inferred from the executor's exit
 * code: a run can exit non-zero after posting a good reply, and exit zero having
 * posted nothing. This predicate is what guards the marker deletion — deleting
 * without an answer would move the boundary backwards and the same message would
 * be answered again on the next tick.
 *
 * The comparison is strict, and GitHub timestamps have second granularity, so an
 * answer posted in the same second as the marker would not be seen. A model run
 * takes far longer than a second, and the failure mode is a harmless leftover
 * marker rather than a duplicate answer, so strictness is the safe direction.
 */
export function agentAnsweredAfter(
  messages: RawMessage[],
  agentUser: string,
  marker: MarkerRef,
): boolean {
  const agent = agentUser.toLowerCase();
  return messages.some(
    (message) =>
      message.author.toLowerCase() === agent &&
      message.kind !== "issue-body" &&
      message.createdAt > marker.createdAt,
  );
}
