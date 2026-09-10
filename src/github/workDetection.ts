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

/** Everything the orphan pull-request decision needs. */
export interface OrphanPrState {
  prSurface: PrSurface;
}

export type SkipReason =
  | "issue-closed"
  | "no-new-messages"
  | "unsafe-pr-branch"
  /** The pull request was closed or merged since the plan was built. */
  | "pr-closed"
  /** It gained a closing reference, so the issue pass owns it now. */
  | "pr-linked"
  /** Another pull request in the same tick already works on this head branch. */
  | "branch-busy";

export interface WorkItem {
  /** Null only on a `pr-orphan` turn: such a pull request has no issue. */
  issue: GitHubIssue | null;
  turn: TurnKind;
  pr: PullRequestRef | null;
  /** Base branch for a discuss turn, the pull request's head branch otherwise. */
  branch: string;
  /**
   * True when the issue has no assignee at all. Always false without an issue.
   *
   * Membership is deliberately not tested: an issue assigned to anyone — a
   * human who triaged it, or the agent from an earlier tick — is already
   * claimed, so the agent must not add itself alongside them.
   */
  needsAssignment: boolean;
  /**
   * True when the turn works on a pull request that has no assignee at all.
   *
   * Always false for a discuss turn: no pull request is known at decision time,
   * so one the model opens during the run is claimed afterwards, where it is
   * first seen. Also false on a `pr-orphan` turn — see the note there.
   */
  prNeedsAssignment: boolean;
  /** The empty analysis on a `pr-orphan` turn — there is no issue surface to read. */
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
  | {
      kind: "skip";
      issue: GitHubIssue | null;
      /** What to name when there is no issue, so a skip is always attributable. */
      pr: PullRequestRef | null;
      reason: SkipReason;
      detail: string;
    };

/**
 * "No issue messages, none new, the agent never spoke there" — the accurate
 * analysis of a surface that does not exist, so the field can stay non-optional
 * and the prompt, watermark and directive paths need no extra guards.
 */
const NO_ISSUE_MESSAGES: SurfaceAnalysis = {
  messages: [],
  newMessages: [],
  newMessageCount: 0,
  hasNewMessage: false,
  lastAgentAt: null,
};

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
function unsafeBranchSkip(
  pr: PullRequestRef,
  issue: GitHubIssue | null,
  policy: BranchPolicy,
): Decision | null {
  if (pr.isCrossRepository) {
    return {
      kind: "skip",
      issue,
      pr,
      reason: "unsafe-pr-branch",
      detail: `pull request #${String(pr.number)} comes from a fork; its head branch is not in this repository`,
    };
  }
  if (protectedHeads(policy).includes(pr.headRefName)) {
    return {
      kind: "skip",
      issue,
      pr,
      reason: "unsafe-pr-branch",
      detail:
        `pull request #${String(pr.number)} has a protected branch (${pr.headRefName}) ` +
        "as its head, so a turn would have to push to it",
    };
  }
  return null;
}

/**
 * Read a pull request as a conversation: what is new on it, and which of its
 * review threads still need an answer.
 *
 * The agent's own replies *inside review threads* count towards the pull
 * request boundary. They are stored separately from `messages`, and the answer
 * check (`agentAnsweredAfter`) already treats such a reply as an answer — so
 * omitting them here made the boundary move backwards relative to the answer
 * check: the marker was deleted, the older review body read as new again, and
 * the same message started a build turn on every tick. The default build
 * prompt explicitly invites replying in the thread, so this was the likely
 * path, not a corner case.
 *
 * Only *agent* thread comments are folded in. Authorized ones already drive
 * the turn through `actionableThreads`, and adding them here would double
 * count them as new messages and duplicate them in the prompt.
 *
 * Shared by the build turn and the orphan turn: the rule must not be able to
 * differ between them, or the same feedback would be new on one and answered on
 * the other.
 */
function analysePrSurface(
  surface: PrSurface,
  p: Participants,
): { prAnalysis: SurfaceAnalysis; actionableThreads: ReviewThread[] } {
  const agentThreadMessages = surface.threads
    .flatMap((thread) => thread.comments)
    .filter((comment) => comment.author.toLowerCase() === p.agentUser.toLowerCase());
  const prAnalysis = analyzeSurface([...surface.messages, ...agentThreadMessages], p);
  return { prAnalysis, actionableThreads: findActionableThreads(surface.threads, p, prAnalysis.lastAgentAt) };
}

export function decideWork(state: IssueState, p: Participants, policy: BranchPolicy): Decision {
  const baseBranch = policy.baseBranch;
  const { issueSurface, prSurface } = state;
  const issue = issueSurface.issue;

  if (issueSurface.state === "CLOSED") {
    return { kind: "skip", issue, pr: null, reason: "issue-closed", detail: "the issue is closed" };
  }

  const issueAnalysis = analyzeSurface(issueSurface.messages, p);
  const needsAssignment = issueSurface.assignees.length === 0;

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
        pr: null,
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
        prNeedsAssignment: false,
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

  const { prAnalysis, actionableThreads } = analysePrSurface(surface, p);
  const hasPrWork = prAnalysis.hasNewMessage || actionableThreads.length > 0;

  if (!hasPrWork && !issueAnalysis.hasNewMessage) {
    return {
      kind: "skip",
      issue,
      pr: surface.pr,
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
      prNeedsAssignment: surface.assignees.length === 0,
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

/**
 * The turn decision for a pull request that closes no issue of this repository.
 *
 * Same rule as a build turn, minus the issue: the agent owes an answer when the
 * newest message from an authorized account has none from the agent after it.
 * Nothing else triggers it — not a first sighting, not a force-push, and not the
 * pull request's own body or commits, which are usually a bot's. That keeps one
 * idempotence argument for all three turn kinds: a run happens only because a
 * human asked for it, and the marker or the reply is what stops it happening
 * again.
 */
export function decideOrphanPrWork(
  state: OrphanPrState,
  p: Participants,
  policy: BranchPolicy,
): Decision {
  const surface = state.prSurface;
  const pr = surface.pr;

  if (pr.state !== "OPEN") {
    return {
      kind: "skip",
      issue: null,
      pr,
      reason: "pr-closed",
      detail: `pull request #${String(pr.number)} is ${pr.state.toLowerCase()}`,
    };
  }

  const unsafe = unsafeBranchSkip(pr, null, policy);
  if (unsafe !== null) return unsafe;

  const { prAnalysis, actionableThreads } = analysePrSurface(surface, p);

  if (!prAnalysis.hasNewMessage && actionableThreads.length === 0) {
    return {
      kind: "skip",
      issue: null,
      pr,
      reason: "no-new-messages",
      detail:
        prAnalysis.lastAgentAt === null
          ? `no messages from authorized accounts on pull request #${String(pr.number)}`
          : `nothing new on pull request #${String(pr.number)} since the agent's message at ${prAnalysis.lastAgentAt}`,
    };
  }

  const reasons: string[] = [];
  if (prAnalysis.hasNewMessage) {
    reasons.push(plural(prAnalysis.newMessageCount, "new pull request message"));
  }
  if (actionableThreads.length > 0) {
    reasons.push(plural(actionableThreads.length, "unresolved review thread"));
  }

  return {
    kind: "work",
    item: {
      issue: null,
      turn: "pr-orphan",
      pr,
      branch: pr.headRefName,
      // Assignment is an issue mechanism: it makes the claim visible in the
      // issue list, and with `issueDiscoveryTechnique: assignee` assigning the
      // agent here would change what the discovery filter matches next tick.
      // The `working…` marker on the pull request is the claim.
      needsAssignment: false,
      // For the same reason, and more directly: the orphan pass discovers by
      // the *pull request's own* assignees, so claiming an unassigned orphan
      // would make it match the filter on the next tick — the agent would
      // permanently own a pull request the operator never opted in. A build
      // turn is safe because it reaches its pull request through an issue that
      // matched the filter, not through the pull request's assignees.
      prNeedsAssignment: false,
      issueAnalysis: NO_ISSUE_MESSAGES,
      prAnalysis,
      actionableThreads,
      reason: `${reasons.join(", ")} on pull request #${String(pr.number)} (no linked issue)`,
      ambiguousPrs: [],
    },
  };
}

/**
 * Let at most one build turn per tick own a head branch.
 *
 * `decideWork` already refuses to run two turns for one issue whose pull
 * requests would write to the same branch, but that guard cannot see across
 * items — and nothing stops two *different* subjects sharing a head. GitHub
 * allows several open pull requests from one branch to different bases, which
 * GitFlow makes routine: `fix/x -> main` carrying `Closes #42` is an issue-pass
 * item, `fix/x -> develop` closing nothing is an orphan, and both can have a new
 * message on the same tick. Running both would put two model sessions on one
 * checkout back to back, the second inheriting whatever the first left there.
 *
 * The first item in tick order keeps the branch — issues before orphans, so a
 * dependency bump never displaces an issue. A discuss turn is left alone: its
 * `branch` is the base branch, which it reads and never writes.
 */
export function skipDuplicateHeadBranches(decisions: Decision[]): Decision[] {
  const owners = new Map<string, PullRequestRef>();
  return decisions.map((decision) => {
    if (decision.kind !== "work") return decision;
    const { item } = decision;
    if (item.turn === "issue-discuss" || item.pr === null) return decision;

    const owner = owners.get(item.branch);
    if (owner === undefined) {
      owners.set(item.branch, item.pr);
      return decision;
    }
    return {
      kind: "skip",
      issue: item.issue,
      pr: item.pr,
      reason: "branch-busy",
      detail:
        `pull request #${String(item.pr.number)} shares its head branch (${item.branch}) with ` +
        `pull request #${String(owner.number)}, which this tick works on first`,
    };
  });
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
