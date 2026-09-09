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

export type SkipReason = "issue-closed" | "no-new-messages" | "unsafe-pr-branch";

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
 * the newest *participant* comment.
 *
 * The authorization filter runs first, before "who spoke last" is decided. That
 * ordering matters: if a maintainer leaves actionable feedback and a bot comments
 * afterwards in the same thread, the newest raw comment is the bot's — and
 * classifying on that would silently suppress the maintainer's request. Other
 * accounts are dropped before detection, not consulted by it.
 *
 * The returned threads carry the filtered comments, so unauthorized text cannot
 * reach the prompt either.
 *
 * The agent having spoken last means the thread is answered even while it is
 * still unresolved — resolving is the reviewer's action, so treating unresolved
 * as actionable would retrigger the same thread on every tick forever.
 */
function findActionableThreads(
  threads: ReviewThread[],
  p: Participants,
  prLastAgentAt: string | null,
): ReviewThread[] {
  const actionable: ReviewThread[] = [];
  for (const thread of threads) {
    if (thread.isResolved) continue;
    const comments = thread.comments.filter((comment) => classifyForThread(comment.author, p) !== "other");
    if (lastAuthorClass(comments, p) !== "authorized") continue;

    // "Answered" cannot mean only "answered *inside this thread*". The prompt
    // gives the model a file and a line, not a comment id, so replying in-thread
    // is not reliably achievable — and the shipped prompt explicitly allows
    // answering on the pull request instead. Judging in-thread alone left every
    // such thread actionable forever: a full model session on every cron firing
    // until a human resolved the thread by hand.
    //
    // So an agent message anywhere on the pull request that is newer than the
    // thread's newest authorized comment counts as the answer.
    const newestAuthorized = comments.at(-1)?.createdAt;
    if (newestAuthorized !== undefined && prLastAgentAt !== null && prLastAgentAt > newestAuthorized) {
      continue;
    }

    actionable.push({ ...thread, comments });
  }
  return actionable;
}

function classifyForThread(author: string, p: Participants): "agent" | "authorized" | "other" {
  const login = author.toLowerCase();
  if (login === p.agentUser.toLowerCase()) return "agent";
  return p.allowedUsers.some((user) => user.toLowerCase() === login) ? "authorized" : "other";
}

function newestPr(prs: PullRequestRef[]): PullRequestRef {
  return [...prs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

export interface BranchPolicy {
  baseBranch: string;
  /** The repository default branch, when known. */
  defaultBranch?: string | null;
  /** Extra branches a turn must never push to. */
  protectedBranches?: string[];
}

/** Branches no build turn may check out and push to. */
function protectedHeads(policy: BranchPolicy): string[] {
  return [policy.baseBranch, policy.defaultBranch ?? "", ...(policy.protectedBranches ?? [])].filter(
    (branch) => branch.length > 0,
  );
}

/**
 * Refuse a build turn that would have to push somewhere it must not.
 *
 * A fork's head branch is not in this repository at all, and preparation would
 * fetch `origin/<name>` — a different branch, or none. An integration branch as
 * the head means the turn would commit to it: a release pull request
 * `develop -> main`, or a back-merge `main -> develop`, both carrying `Closes #N`.
 */
function unsafeBranchSkip(pr: PullRequestRef, issue: GitHubIssue, policy: BranchPolicy): Decision | null {
  if (pr.isCrossRepository) {
    return {
      kind: "skip",
      issue,
      reason: "unsafe-pr-branch",
      detail: `pull request #${String(pr.number)} comes from a fork; its head branch is not in this repository`,
    };
  }
  if (protectedHeads(policy).includes(pr.headRefName)) {
    return {
      kind: "skip",
      issue,
      reason: "unsafe-pr-branch",
      detail:
        `pull request #${String(pr.number)} has a protected branch (${pr.headRefName}) ` +
        "as its head, so a turn would have to push to it",
    };
  }
  return null;
}

export function decideWork(state: IssueState, p: Participants, policy: BranchPolicy): Decision {
  const baseBranch = policy.baseBranch;
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

  const unsafe = unsafeBranchSkip(surface.pr, issue, policy);
  if (unsafe !== null) return unsafe;

  // The agent's own replies *inside review threads* count towards the pull
  // request boundary. They are stored separately from `messages`, and the answer
  // check (`agentAnsweredAfter`) already treats such a reply as an answer — so
  // omitting them here made the boundary move backwards relative to the answer
  // check: the marker was deleted, the older review body read as new again, and
  // the same message started a build turn on every tick. The default build
  // prompt explicitly invites replying in the thread, so this was the likely
  // path, not a corner case.
  //
  // Only *agent* thread comments are folded in. Authorized ones already drive
  // the turn through `actionableThreads`, and adding them here would double
  // count them as new messages and duplicate them in the prompt.
  const agentThreadMessages = surface.threads
    .flatMap((thread) => thread.comments)
    .filter((comment) => comment.author.toLowerCase() === p.agentUser.toLowerCase());
  const prAnalysis = analyzeSurface([...surface.messages, ...agentThreadMessages], p);
  const actionableThreads = findActionableThreads(surface.threads, p, prAnalysis.lastAgentAt);
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
