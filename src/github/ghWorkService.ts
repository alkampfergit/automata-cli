import { spawnSync } from "node:child_process";
import type { IssueDiscoveryTechnique } from "../config/configStore.js";
import type { GitHubIssue } from "../config/githubService.js";
import type { RawMessage } from "./conversation.js";

/**
 * The `gh` calls `do-work` needs.
 *
 * Kept separate from `config/githubService.ts` and `git/gitService.ts` because
 * two of the queries differ materially from theirs: the pull-request link map is
 * resolved for a whole set of issues in one call, and review threads are fetched
 * with *all* their comments (the existing query asks for only the first, which
 * cannot tell us whether the agent already replied inside the thread).
 */

export interface PullRequestRef {
  number: number;
  url: string;
  title: string;
  headRefName: string;
  baseRefName: string;
  /** True when the head branch lives in a fork rather than this repository. */
  isCrossRepository: boolean;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  updatedAt: string;
}

export interface ReviewThread {
  path: string;
  line: number | null;
  isResolved: boolean;
  /** Every comment in the thread, oldest first. */
  comments: RawMessage[];
  /** The newest comment's URL, so the model can actually reply in the thread. */
  url: string | null;
}

export interface IssueSurface {
  issue: GitHubIssue;
  state: "OPEN" | "CLOSED";
  assignees: string[];
  labels: string[];
  messages: RawMessage[];
}

export interface PrSurface {
  pr: PullRequestRef;
  /** Conversation comments and non-empty review bodies. */
  messages: RawMessage[];
  threads: ReviewThread[];
}

/** Identifies a posted marker comment so it can be updated or deleted later. */
export interface MarkerRef {
  commentId: string;
  createdAt: string;
}

interface RawAuthor {
  login?: string;
}

interface RawIssueView {
  number: number;
  title: string;
  body: string;
  url: string;
  state?: string;
  author?: RawAuthor;
  createdAt: string;
  assignees?: RawAuthor[];
  labels?: { name?: string }[];
  comments?: { author?: RawAuthor; body: string; createdAt: string }[];
}

interface RawPrView {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  baseRefName?: string;
  isCrossRepository?: boolean;
  state?: string;
  isDraft?: boolean;
  body: string;
  author?: RawAuthor;
  createdAt: string;
  updatedAt?: string;
  comments?: { author?: RawAuthor; body: string; createdAt: string }[];
  reviews?: { author?: RawAuthor; body: string; submittedAt?: string; createdAt?: string }[];
}

interface RawLinkMapResponse {
  data: {
    repository: {
      defaultBranchRef: { name: string } | null;
      pullRequests: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: {
          number: number;
          url: string;
          title: string;
          headRefName: string;
          baseRefName: string;
          isCrossRepository: boolean;
          isDraft: boolean;
          updatedAt: string;
          closingIssuesReferences: {
            pageInfo: { hasNextPage: boolean };
            nodes: { number: number; repository: { nameWithOwner: string } }[];
          };
        }[];
      };
    };
  };
}

interface RawThreadsResponse {
  data: {
    repository: {
      pullRequest: {
        reviewThreads: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: {
            isResolved: boolean;
            isOutdated: boolean;
            path: string;
            line: number | null;
            comments: {
              pageInfo: { hasPreviousPage: boolean };
              nodes: { author?: RawAuthor; body: string; createdAt: string; url?: string }[];
            };
          }[];
        };
      };
    };
  };
}

interface RawComment {
  id: number;
  created_at: string;
}

function run(cmd: string, args: string[]): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new Error(`\`${cmd}\` CLI is not installed or not on PATH.`);
    }
    throw new Error(err.message);
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status ?? 1 };
}

function ghJson<T>(args: string[], what: string): T {
  const { stdout, stderr, status } = run("gh", args);
  if (status !== 0) {
    throw new Error(stderr.trim() || `Failed to ${what}. Is \`gh\` installed and authenticated?`);
  }
  return JSON.parse(stdout) as T;
}

function login(author: RawAuthor | undefined): string {
  return author?.login ?? "";
}

function byCreatedAt(a: RawMessage, b: RawMessage): number {
  return a.createdAt.localeCompare(b.createdAt);
}

export function getRepoSlug(): { owner: string; repo: string } {
  const { stdout, status } = run("git", ["remote", "get-url", "origin"]);
  if (status !== 0) {
    throw new Error("Could not read the `origin` remote. Is this a git repository with a remote?");
  }
  const url = stdout.trim();
  const match =
    /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url) ??
    /github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
  if (!match) {
    throw new Error(`Could not determine the GitHub owner/repo from the origin remote: ${url}`);
  }
  return { owner: match[1], repo: match[2] };
}

/**
 * The login `gh` is authenticated as, or null when it cannot be determined.
 *
 * Null is a legitimate answer: a GitHub App installation token has no user, so
 * callers must treat it as "unknown" rather than as a failure.
 */
export function getAuthenticatedLogin(): string | null {
  const { stdout, status } = run("gh", ["api", "user", "--jq", ".login"]);
  if (status !== 0) return null;
  const login = stdout.trim();
  return login.length > 0 ? login : null;
}

export function listCandidateIssues(
  technique: IssueDiscoveryTechnique,
  value: string,
  limit: number,
): GitHubIssue[] {
  const args = [
    "issue",
    "list",
    "--state",
    "open",
    "--limit",
    String(limit),
    "--json",
    "number,title,body,url",
  ];

  switch (technique) {
    case "label":
      args.push("--label", value);
      break;
    case "assignee":
      args.push("--assignee", value);
      break;
    case "title-contains":
      args.push("--search", `${value} in:title`);
      break;
  }

  return ghJson<GitHubIssue[]>(args, "query GitHub issues");
}

export function getIssueSurface(issueNumber: number): IssueSurface {
  const raw = ghJson<RawIssueView>(
    [
      "issue",
      "view",
      String(issueNumber),
      "--json",
      "number,title,body,url,state,author,createdAt,assignees,labels,comments",
    ],
    `read issue #${String(issueNumber)}`,
  );

  const messages: RawMessage[] = [
    {
      kind: "issue-body" as const,
      author: login(raw.author),
      body: raw.body,
      createdAt: raw.createdAt,
    },
    ...(raw.comments ?? []).map((comment) => ({
      kind: "issue-comment" as const,
      author: login(comment.author),
      body: comment.body,
      createdAt: comment.createdAt,
    })),
  ].sort(byCreatedAt);

  return {
    issue: { number: raw.number, title: raw.title, body: raw.body, url: raw.url },
    state: raw.state === "CLOSED" ? "CLOSED" : "OPEN",
    assignees: (raw.assignees ?? []).map(login).filter((name) => name.length > 0),
    labels: (raw.labels ?? []).map((label) => label.name ?? "").filter((name) => name.length > 0),
    messages,
  };
}

const LINK_MAP_QUERY = `
query($owner:String!,$repo:String!,$cursor:String){
  repository(owner:$owner,name:$repo){
    defaultBranchRef{ name }
    pullRequests(states:OPEN, first:100, after:$cursor, orderBy:{field:UPDATED_AT, direction:DESC}){
      pageInfo{ hasNextPage endCursor }
      nodes{
        number url title headRefName baseRefName isCrossRepository isDraft updatedAt
        closingIssuesReferences(first:50){
          pageInfo{ hasNextPage }
          nodes{ number repository{ nameWithOwner } }
        }
      }
    }
  }
}`.trim();

/** Guard against an unbounded loop if the API ever reports hasNextPage forever. */
const MAX_LINK_MAP_PAGES = 50;

type RawLinkMapNode = RawLinkMapResponse["data"]["repository"]["pullRequests"]["nodes"][number];

/** Record one pull request against every issue *in this repository* it closes. */
function indexPullRequest(
  map: Map<number, PullRequestRef[]>,
  node: RawLinkMapNode,
  nameWithOwner: string,
): void {
  const ref: PullRequestRef = {
    number: node.number,
    url: node.url,
    title: node.title,
    headRefName: node.headRefName,
    baseRefName: node.baseRefName,
    isCrossRepository: node.isCrossRepository,
    state: "OPEN",
    isDraft: node.isDraft,
    updatedAt: node.updatedAt,
  };

  if (node.closingIssuesReferences.pageInfo?.hasNextPage) {
    // Callers treat absence from this map as proof that an issue has no pull
    // request, so a partial map is not a degraded answer — it is a wrong one
    // that starts a competing implementation. Refuse instead.
    throw new Error(
      `Pull request #${String(node.number)} closes more than 50 issues, so the issue-to-pull-request ` +
        "map cannot be read completely. Refusing the tick rather than risk starting work on an issue " +
        "that already has a pull request.",
    );
  }

  for (const issue of node.closingIssuesReferences.nodes) {
    // `Closes other-org/lib#42` would otherwise be indexed as this repository's
    // issue 42, linking an unrelated pull request to it.
    if (issue.repository.nameWithOwner !== nameWithOwner) continue;
    const existing = map.get(issue.number);
    if (existing) {
      existing.push(ref);
    } else {
      map.set(issue.number, [ref]);
    }
  }
}

/**
 * Map every open pull request to the issues it closes, inverted so callers can
 * ask "does this issue have a pull request?" for a whole set in one API call.
 *
 * The link is GitHub's own closing reference, which is what `Closes #N` in a PR
 * body produces — the same link `implement-next` already creates.
 */
export interface OpenPrLinkMap {
  byIssue: Map<number, PullRequestRef[]>;
  /** The repository default branch, so a build turn can refuse to push to it. */
  defaultBranch: string | null;
}

export function getOpenPrLinkMap(): OpenPrLinkMap {
  const { owner, repo } = getRepoSlug();
  const map = new Map<number, PullRequestRef[]>();
  let defaultBranch: string | null = null;

  // Every page is fetched: callers treat this map as authoritative, so a
  // truncated result would make `do-work` open a competing implementation on an
  // issue that already has a pull request.
  let cursor: string | null = null;
  for (let page = 0; page < MAX_LINK_MAP_PAGES; page++) {
    const args = ["api", "graphql", "-f", `query=${LINK_MAP_QUERY}`, "-f", `owner=${owner}`, "-f", `repo=${repo}`];
    if (cursor !== null) args.push("-f", `cursor=${cursor}`);

    const response = ghJson<RawLinkMapResponse>(args, "query open pull requests");
    defaultBranch = response.data.repository.defaultBranchRef?.name ?? defaultBranch;
    const connection = response.data.repository.pullRequests;

    for (const node of connection.nodes) {
      indexPullRequest(map, node, `${owner}/${repo}`);
    }

    if (!connection.pageInfo?.hasNextPage || connection.pageInfo.endCursor === null) {
      return { byIssue: map, defaultBranch };
    }
    cursor = connection.pageInfo.endCursor;
  }

  throw new Error(
    `Stopped paginating open pull requests after ${String(MAX_LINK_MAP_PAGES)} pages, so the ` +
      "issue-to-pull-request map cannot be trusted. Refusing the tick rather than risk starting work " +
      "on an issue that already has a pull request.",
  );
}

const REVIEW_THREADS_QUERY = `
query($owner:String!,$repo:String!,$prNumber:Int!,$cursor:String){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$prNumber){
      reviewThreads(first:100, after:$cursor){
        pageInfo{ hasNextPage endCursor }
        nodes{
          isResolved isOutdated path line
          comments(last:100){
            pageInfo{ hasPreviousPage }
            nodes{ author{login} body createdAt url }
          }
        }
      }
    }
  }
}`.trim();

/** Same guard as the link map: bounded, and a refusal rather than a partial read. */
const MAX_THREAD_PAGES = 50;

function normalizePrState(state: string | undefined): PullRequestRef["state"] {
  if (state === "MERGED") return "MERGED";
  if (state === "CLOSED") return "CLOSED";
  return "OPEN";
}

/**
 * Every unresolved review thread on a pull request, following pagination.
 *
 * A single page would make authorized feedback past thread 100 invisible to both
 * detection and the prompt, so the agent would silently never answer it.
 */
function getReviewThreads(prNumber: number): ReviewThread[] {
  const { owner, repo } = getRepoSlug();
  const threads: ReviewThread[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_THREAD_PAGES; page++) {
    const args = [
      "api",
      "graphql",
      "-f",
      `query=${REVIEW_THREADS_QUERY}`,
      "-f",
      `owner=${owner}`,
      "-f",
      `repo=${repo}`,
      "-F",
      `prNumber=${String(prNumber)}`,
    ];
    if (cursor !== null) args.push("-f", `cursor=${cursor}`);

    const response = ghJson<RawThreadsResponse>(
      args,
      `query review threads for pull request #${String(prNumber)}`,
    );
    const connection = response.data.repository.pullRequest.reviewThreads;

    for (const node of connection.nodes) {
      if (node.comments.pageInfo?.hasPreviousPage) {
        // Only the newest 100 comments come back. More than that in unauthorized
        // follow-ups could push an authorized maintainer's request out of the
        // window; after filtering the thread would look empty and the request
        // would be silently suppressed.
        throw new Error(
          `Review thread on ${node.path} in pull request #${String(prNumber)} has more than 100 comments, ` +
            "so the earliest ones were not read. Refusing rather than risk suppressing a maintainer's request.",
        );
      }
      threads.push({
        path: node.path,
        line: node.line ?? null,
        isResolved: node.isResolved,
        url: node.comments.nodes.at(-1)?.url ?? null,
        comments: node.comments.nodes
          .map((comment) => ({
            kind: "thread-comment" as const,
            author: login(comment.author),
            body: comment.body,
            createdAt: comment.createdAt,
          }))
          .sort(byCreatedAt),
      });
    }

    if (!connection.pageInfo?.hasNextPage || connection.pageInfo.endCursor === null) {
      return threads;
    }
    cursor = connection.pageInfo.endCursor;
  }

  throw new Error(
    `Stopped paginating review threads for pull request #${String(prNumber)} after ` +
      `${String(MAX_THREAD_PAGES)} pages; refusing rather than answering only part of the feedback.`,
  );
}

export function getPrSurface(prNumber: number): PrSurface {
  const raw = ghJson<RawPrView>(
    [
      "pr",
      "view",
      String(prNumber),
      "--json",
      "number,title,url,headRefName,baseRefName,isCrossRepository,state,isDraft,body,author,createdAt,updatedAt,comments,reviews",
    ],
    `read pull request #${String(prNumber)}`,
  );

  const messages: RawMessage[] = [
    ...(raw.comments ?? []).map((comment) => ({
      kind: "pr-comment" as const,
      author: login(comment.author),
      body: comment.body,
      createdAt: comment.createdAt,
    })),
    // A review with no body carries no message — only its inline comments do,
    // and those arrive through the review-thread query.
    ...(raw.reviews ?? [])
      .filter((review) => review.body.trim().length > 0)
      .map((review) => ({
        kind: "pr-review" as const,
        author: login(review.author),
        body: review.body,
        createdAt: review.submittedAt ?? review.createdAt ?? "",
      })),
  ].sort(byCreatedAt);

  const threads = getReviewThreads(prNumber);

  const state = normalizePrState(raw.state);

  return {
    pr: {
      number: raw.number,
      url: raw.url,
      title: raw.title,
      headRefName: raw.headRefName,
      baseRefName: raw.baseRefName ?? "",
      isCrossRepository: raw.isCrossRepository ?? false,
      state,
      isDraft: raw.isDraft ?? false,
      updatedAt: raw.updatedAt ?? raw.createdAt,
    },
    messages,
    threads,
  };
}

/**
 * Add the agent as an assignee, leaving any existing assignee in place so an
 * issue triaged to a human keeps that triage.
 */
export function assignIssueToAgent(issueNumber: number, agentUser: string): void {
  const { stderr, status } = run("gh", [
    "issue",
    "edit",
    String(issueNumber),
    "--add-assignee",
    agentUser,
  ]);
  if (status !== 0) {
    throw new Error(stderr.trim() || `Failed to assign issue #${String(issueNumber)} to ${agentUser}.`);
  }
}

/**
 * Post the "working" marker and return its identity.
 *
 * Posted through the REST API rather than `gh issue comment` because the marker
 * has to be edited or deleted afterwards, which needs the comment id, and the
 * answer check needs its creation timestamp — `gh issue comment` reports neither
 * usably. A pull request is an issue in GitHub's model, so one endpoint serves
 * both surfaces and the update/delete paths are shared.
 */
export function postMarker(_surface: "issue" | "pr", number: number, body: string): MarkerRef {
  const { owner, repo } = getRepoSlug();
  const raw = ghJson<RawComment>(
    [
      "api",
      "--method",
      "POST",
      `repos/${owner}/${repo}/issues/${String(number)}/comments`,
      "-f",
      `body=${body}`,
    ],
    `post a comment on #${String(number)}`,
  );
  return { commentId: String(raw.id), createdAt: raw.created_at };
}

export function updateMarker(marker: MarkerRef, body: string): void {
  const { owner, repo } = getRepoSlug();
  const { stderr, status } = run("gh", [
    "api",
    "--method",
    "PATCH",
    `repos/${owner}/${repo}/issues/comments/${marker.commentId}`,
    "-f",
    `body=${body}`,
  ]);
  if (status !== 0) {
    throw new Error(stderr.trim() || `Failed to update comment ${marker.commentId}.`);
  }
}

/** Delete the marker. A comment that is already gone counts as success. */
export function deleteMarker(marker: MarkerRef): void {
  const { owner, repo } = getRepoSlug();
  const { stderr, status } = run("gh", [
    "api",
    "--method",
    "DELETE",
    `repos/${owner}/${repo}/issues/comments/${marker.commentId}`,
  ]);
  if (status !== 0) {
    if (/not found/i.test(stderr) || /HTTP 404/i.test(stderr)) return;
    throw new Error(stderr.trim() || `Failed to delete comment ${marker.commentId}.`);
  }
}
