import { spawnSync } from "node:child_process";
import { readConfig } from "../config/configStore.js";
import * as azdoService from "../config/azdoService.js";

export interface PrCheck {
  name: string;
  status: string;
  conclusion: string | null;
  description: string;
  detailsUrl: string;
}

export interface PrComment {
  author: string;
  body: string;
  path: string;
  line: number | null;
  createdAt: string;
}

export interface PrInfo {
  number: number;
  title: string;
  state: string;
  url: string;
  checks: PrCheck[];
}

function run(cmd: string, args: string[]): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? 1,
  };
}

export function getCurrentBranch(): string {
  const { stdout, status } = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (status !== 0) {
    throw new Error("Failed to determine current branch. Are you inside a git repository?");
  }
  return stdout.trim();
}

interface RawCheckRollup {
  name: string;
  status: string;
  conclusion: string | null;
  description: string;
  detailsUrl: string;
}

interface RawPrView {
  number: number;
  title: string;
  state: string;
  url: string;
  headRefOid: string;
  statusCheckRollup: RawCheckRollup[] | null;
}

interface CheckRunOutput {
  title: string | null;
  summary: string | null;
}

interface CheckRunApiItem {
  name: string;
  html_url: string;
  details_url: string;
  output: CheckRunOutput;
}


function parseOwnerRepo(): string | null {
  const { stdout, status } = run("git", ["remote", "get-url", "origin"]);
  if (status !== 0) return null;
  const url = stdout.trim();
  const https = url.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (https) return https[1];
  const ssh = url.match(/github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (ssh) return ssh[1];
  return null;
}

function extractLastMarkdownUrl(markdown: string): string | null {
  const matches = [...markdown.matchAll(/\]\((https?:\/\/[^)]+)\)/g)];
  return matches.length > 0 ? (matches[matches.length - 1][1] ?? null) : null;
}

function fetchCheckRunOutputs(ownerRepo: string, sha: string): Map<string, { title: string; detailsUrl: string }> {
  const { stdout, status } = run("gh", [
    "api",
    `repos/${ownerRepo}/commits/${sha}/check-runs`,
    "--jq",
    ".check_runs[] | {name, html_url, details_url, output}",
  ]);
  const map = new Map<string, { title: string; detailsUrl: string }>();
  if (status !== 0) return map;
  for (const line of stdout.trim().split("\n")) {
    if (!line) continue;
    try {
      const item = JSON.parse(line) as CheckRunApiItem;
      const title = item.output?.title ?? "";
      const summaryUrl = item.output?.summary ? extractLastMarkdownUrl(item.output.summary) : null;
      const detailsUrl = summaryUrl ?? (item.details_url !== item.html_url ? item.details_url : "") ?? item.html_url;
      map.set(item.name, { title, detailsUrl });
    } catch {
      // skip malformed line
    }
  }
  return map;
}

function getPrInfoGh(branch: string): PrInfo | null {
  const { stdout, stderr, status } = run("gh", [
    "pr",
    "view",
    branch,
    "--json",
    "number,title,state,url,headRefOid,statusCheckRollup",
  ]);
  if (status !== 0) {
    if (stderr.includes("no pull requests found") || stderr.includes("Could not resolve")) {
      return null;
    }
    throw new Error(stderr.trim() || "Failed to query GitHub. Is `gh` installed and authenticated?");
  }
  const raw = JSON.parse(stdout) as RawPrView;

  const failedChecks = (raw.statusCheckRollup ?? []).filter(
    (c) => c.conclusion !== null && ["FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "CANCELLED"].includes(c.conclusion),
  );
  const ownerRepo = failedChecks.length > 0 ? parseOwnerRepo() : null;
  const checkOutputs = ownerRepo ? fetchCheckRunOutputs(ownerRepo, raw.headRefOid) : new Map();

  const checks: PrCheck[] = (raw.statusCheckRollup ?? []).map((c) => {
    const enriched = checkOutputs.get(c.name);
    return {
      name: c.name,
      status: c.status,
      conclusion: c.conclusion,
      description: enriched?.title || c.description || "",
      detailsUrl: enriched?.detailsUrl || c.detailsUrl || "",
    };
  });
  return { number: raw.number, title: raw.title, state: raw.state, url: raw.url, checks };
}

export function getPrInfo(branch: string): PrInfo | null {
  const config = readConfig();
  if (config.remoteType === "azdo") {
    return azdoService.getPrInfo();
  }
  return getPrInfoGh(branch);
}

export function isUpstreamGone(branch: string): boolean {
  const { status } = run("git", ["ls-remote", "--exit-code", "--heads", "origin", branch]);
  // exit code 2 means the ref was not found (upstream is gone)
  return status !== 0;
}

export function hasUncommittedChanges(): boolean {
  const { stdout } = run("git", ["status", "--porcelain"]);
  return stdout.trim().length > 0;
}

export function checkoutAndPull(targetBranch: string): void {
  const checkout = run("git", ["checkout", targetBranch]);
  if (checkout.status !== 0) {
    throw new Error(`Failed to checkout ${targetBranch}: ${checkout.stderr.trim()}`);
  }
  const pull = run("git", ["pull"]);
  if (pull.status !== 0) {
    throw new Error(`Failed to pull ${targetBranch}: ${pull.stderr.trim()}`);
  }
}

export function fetchPrune(): void {
  const result = run("git", ["fetch", "--prune"]);
  if (result.status !== 0) {
    throw new Error(`Failed to fetch --prune: ${result.stderr.trim()}`);
  }
}

export function deleteLocalBranch(branch: string): void {
  const result = run("git", ["branch", "-D", branch]);
  if (result.status !== 0) {
    throw new Error(`Failed to delete branch ${branch}: ${result.stderr.trim()}`);
  }
}

interface RawReviewThreadComment {
  author: { login: string };
  body: string;
  path: string;
  line: number | null;
  createdAt: string;
}

interface RawReviewThread {
  isResolved: boolean;
  isOutdated: boolean;
  comments: { nodes: RawReviewThreadComment[] };
}

interface RawGraphQlResponse {
  data: {
    repository: {
      pullRequest: {
        reviewThreads: { nodes: RawReviewThread[] };
      };
    };
  };
}

const REVIEW_THREADS_QUERY = `
query($owner:String!,$repo:String!,$prNumber:Int!){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$prNumber){
      reviewThreads(first:100){
        nodes{
          isResolved
          isOutdated
          comments(first:1){
            nodes{ author{login} body path line createdAt }
          }
        }
      }
    }
  }
}`.trim();

function getPrCommentsGh(branch: string): PrComment[] | null {
  // Step 1: get PR number
  const prView = run("gh", ["pr", "view", branch, "--json", "number"]);
  if (prView.status !== 0) {
    if (prView.stderr.includes("no pull requests found") || prView.stderr.includes("Could not resolve")) {
      return null;
    }
    throw new Error(prView.stderr.trim() || "Failed to query GitHub. Is `gh` installed and authenticated?");
  }
  const { number: prNumber } = JSON.parse(prView.stdout) as { number: number };

  // Step 2: resolve owner/repo
  const ownerRepo = parseOwnerRepo();
  if (!ownerRepo) {
    throw new Error("Could not determine GitHub owner/repo from git remote. Is 'origin' set to a GitHub URL?");
  }
  const slashIdx = ownerRepo.indexOf("/");
  const owner = ownerRepo.slice(0, slashIdx);
  const repo = ownerRepo.slice(slashIdx + 1);

  // Step 3: fetch review threads via GraphQL
  const gql = run("gh", [
    "api", "graphql",
    "-f", `query=${REVIEW_THREADS_QUERY}`,
    "-f", `owner=${owner}`,
    "-f", `repo=${repo}`,
    "-F", `prNumber=${String(prNumber)}`,
  ]);
  if (gql.status !== 0) {
    throw new Error(gql.stderr.trim() || "Failed to query GitHub GraphQL API.");
  }
  const response = JSON.parse(gql.stdout) as RawGraphQlResponse;
  const threads = response.data.repository.pullRequest.reviewThreads.nodes;
  return threads
    .filter((t) => !t.isResolved && t.comments.nodes.length > 0)
    .map((t) => {
      const c = t.comments.nodes[0] as RawReviewThreadComment;
      return {
        author: c.author.login,
        body: c.body,
        path: c.path,
        line: c.line ?? null,
        createdAt: c.createdAt,
      };
    });
}

export function getPrComments(branch: string): PrComment[] | null | "unsupported" {
  const config = readConfig();
  if (config.remoteType === "azdo") {
    return "unsupported";
  }
  return getPrCommentsGh(branch);
}

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function getLatestTagOnMaster(): string | null {
  const { stdout, status } = run("git", ["describe", "--tags", "--abbrev=0", "master"]);
  if (status !== 0) return null;
  const tag = stdout.trim();
  const m = SEMVER_RE.exec(tag);
  if (!m) return null;
  return `${m[1]}.${m[2]}.${m[3]}`;
}

export function bumpMinorVersion(version: string): string {
  const m = SEMVER_RE.exec(version);
  if (!m) throw new Error(`Invalid semver: ${version}`);
  return `${m[1]}.${String(Number(m[2]) + 1)}.0`;
}

export function tagExists(version: string): boolean {
  const { stdout } = run("git", ["tag", "-l", version]);
  return stdout.trim().length > 0;
}

export function publishRelease(version: string, dryRun: boolean): void {
  const releaseBranch = `release/${version}`;

  const steps: Array<{ args: string[]; desc: string }> = [
    { args: ["checkout", "-b", releaseBranch], desc: `git checkout -b ${releaseBranch}` },
    { args: ["checkout", "master"], desc: `git checkout master` },
    { args: ["merge", "--no-ff", releaseBranch], desc: `git merge --no-ff ${releaseBranch}` },
    { args: ["tag", version], desc: `git tag ${version}` },
    { args: ["checkout", "develop"], desc: `git checkout develop` },
    { args: ["merge", "--no-ff", releaseBranch], desc: `git merge --no-ff ${releaseBranch}` },
    { args: ["branch", "-d", releaseBranch], desc: `git branch -d ${releaseBranch}` },
    { args: ["push", "origin", "develop", "master", version], desc: `git push origin develop master ${version}` },
  ];

  for (const step of steps) {
    if (dryRun) {
      process.stdout.write(`[dry-run] ${step.desc}\n`);
      continue;
    }
    const { status, stderr } = run("git", step.args);
    if (status !== 0) {
      throw new Error(`Command failed: ${step.desc}\n${stderr.trim()}`);
    }
  }
}
