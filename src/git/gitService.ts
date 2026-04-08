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
  sonarcloudUrl?: string;
  sonarNewIssues?: number | null;
  sonarNewIssuesNote?: string;
  sonarFailures?: SonarFailureSummary;
}

export interface SonarGateViolation {
  metricKey: string;
  status: string;
  comparator?: string;
  actualValue?: string;
  errorThreshold?: string;
}

export interface SonarIssue {
  key: string;
  rule?: string;
  severity?: string;
  type?: string;
  message: string;
  path?: string;
  line?: number | null;
  explanation?: string;
}

export interface SonarSecurityHotspot {
  key: string;
  rule: string;
  ruleName?: string;
  status: string;
  message: string;
  path?: string;
  line?: number | null;
  securityCategory?: string;
  vulnerabilityProbability?: string;
  riskDescription?: string;
  vulnerabilityDescription?: string;
  fixRecommendations?: string;
}

export interface SonarFailureSummary {
  status: "available" | "private" | "unavailable";
  qualityGateStatus?: string;
  gateViolations: SonarGateViolation[];
  issues: SonarIssue[];
  securityHotspots: SonarSecurityHotspot[];
  privateMessage?: string;
  unavailableMessage?: string;
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

interface SonarProjectStatusCondition {
  status?: string;
  metricKey?: string;
  comparator?: string;
  actualValue?: string;
  errorThreshold?: string;
}

interface SonarProjectStatusResponse {
  projectStatus?: {
    status?: string;
    conditions?: SonarProjectStatusCondition[];
  };
  errors?: Array<{ msg?: string }>;
}

interface RawSonarIssue {
  key?: string;
  rule?: string;
  severity?: string;
  type?: string;
  message?: string;
  component?: string;
  line?: number;
  textRange?: {
    startLine?: number;
  };
}

interface RawSonarHotspot {
  key?: string;
  component?: string;
  securityCategory?: string;
  vulnerabilityProbability?: string;
  status?: string;
  line?: number;
  message?: string;
  ruleKey?: string;
  textRange?: {
    startLine?: number;
  };
}

interface RawSonarComponent {
  key?: string;
  path?: string;
}

interface RawSonarRule {
  key?: string;
  name?: string;
  htmlDesc?: string;
  htmlNote?: string;
}

interface SonarIssuesSearchResponse {
  paging?: {
    pageIndex?: number;
    pageSize?: number;
    total?: number;
  };
  issues?: RawSonarIssue[];
  components?: RawSonarComponent[];
  rules?: RawSonarRule[];
  errors?: Array<{ msg?: string }>;
}

interface RawSonarHotspotRule {
  key?: string;
  name?: string;
  securityCategory?: string;
  vulnerabilityProbability?: string;
  riskDescription?: string;
  vulnerabilityDescription?: string;
  fixRecommendations?: string;
}

interface SonarHotspotsSearchResponse {
  paging?: {
    pageIndex?: number;
    pageSize?: number;
    total?: number;
  };
  hotspots?: RawSonarHotspot[];
  components?: RawSonarComponent[];
  errors?: Array<{ msg?: string }>;
}

interface SonarHotspotShowResponse {
  key?: string;
  component?: RawSonarComponent;
  rule?: RawSonarHotspotRule;
  status?: string;
  line?: number;
  message?: string;
  textRange?: {
    startLine?: number;
  };
}

interface SonarFetchOk<T> {
  ok: true;
  status: number;
  data: T;
}

interface SonarFetchError {
  ok: false;
  status: number | null;
}

type SonarFetchResult<T> = SonarFetchOk<T> | SonarFetchError;

interface SonarFailureSummaryResult {
  summary: SonarFailureSummary;
  issueTotal: number | null;
  issueNote?: string;
}

interface SonarNewIssuesResult {
  total: number | null;
  note?: string;
}

const SONAR_FETCH_TIMEOUT_MS = 5000;
const SONAR_FAIL_CONCLUSIONS = new Set(["FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "CANCELLED"]);

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

function extractSonarProjectKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    const id = parsed.searchParams.get("id");
    return id ?? null;
  } catch {
    return null;
  }
}

function buildSonarPullRequestUrl(projectKey: string, prNumber: number): string {
  return `https://sonarcloud.io/summary/new_code?id=${encodeURIComponent(projectKey)}&pullRequest=${String(prNumber)}`;
}

function resolveSonarPullRequestUrl(url: string, prNumber: number): string {
  const projectKey = extractSonarProjectKey(url);
  if (!projectKey) return url;
  return buildSonarPullRequestUrl(projectKey, prNumber);
}

function isSonarUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hostname === "sonarcloud.io" || hostname.endsWith(".sonarcloud.io");
  } catch {
    return false;
  }
}

function stripHtml(text: string): string {
  let stripped = "";
  let inTag = false;

  for (const char of text) {
    if (char === "<") {
      inTag = true;
      stripped += " ";
      continue;
    }
    if (char === ">") {
      inTag = false;
      continue;
    }
    if (!inTag) {
      stripped += char;
    }
  }

  return stripped;
}

function normalizeText(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const normalized = stripHtml(text).replaceAll(/\s+/g, " ").trim();
  return normalized || undefined;
}

function resolveSonarPath(componentKey: string | undefined, components: Map<string, string>): string | undefined {
  if (!componentKey) return undefined;
  const mapped = components.get(componentKey);
  if (mapped) return mapped;
  const separatorIndex = componentKey.indexOf(":");
  if (separatorIndex === -1) return undefined;
  const path = componentKey.slice(separatorIndex + 1).trim();
  return path || undefined;
}

function mapSonarIssuesPage(
  data: SonarIssuesSearchResponse,
  targetIssues: SonarIssue[],
  components: Map<string, string>,
  rules: Map<string, string>,
): void {
  for (const component of data.components ?? []) {
    if (component.key && component.path) {
      components.set(component.key, component.path);
    }
  }

  for (const rule of data.rules ?? []) {
    if (!rule.key) continue;
    const explanation = normalizeText(rule.htmlDesc) ?? normalizeText(rule.htmlNote) ?? normalizeText(rule.name);
    if (explanation) {
      rules.set(rule.key, explanation);
    }
  }

  for (const issue of data.issues ?? []) {
    if (!issue.key || !issue.message) continue;

    const ruleKey = issue.rule;
    const mappedIssue: SonarIssue = {
      key: issue.key,
      severity: issue.severity,
      type: issue.type,
      message: issue.message,
      path: resolveSonarPath(issue.component, components),
      line: issue.line ?? issue.textRange?.startLine ?? null,
      ...(ruleKey ? { rule: ruleKey } : {}),
      ...(ruleKey && rules.has(ruleKey) ? { explanation: rules.get(ruleKey) } : {}),
    };
    targetIssues.push(mappedIssue);
  }
}

function mapSonarHotspotsPage(
  data: SonarHotspotsSearchResponse,
  targetHotspots: RawSonarHotspot[],
  components: Map<string, string>,
): void {
  for (const component of data.components ?? []) {
    if (component.key && component.path) {
      components.set(component.key, component.path);
    }
  }

  targetHotspots.push(...(data.hotspots ?? []));
}

function mapSonarHotspot(
  hotspot: RawSonarHotspot,
  components: Map<string, string>,
  detail?: SonarHotspotShowResponse,
): SonarSecurityHotspot {
  const rule = detail?.rule;
  return {
    key: detail?.key ?? hotspot.key ?? "",
    rule: hotspot.ruleKey ?? rule?.key ?? "",
    ruleName: normalizeText(rule?.name),
    status: detail?.status ?? hotspot.status ?? "UNKNOWN",
    message: detail?.message ?? hotspot.message ?? "",
    path: detail?.component?.path ?? resolveSonarPath(hotspot.component, components),
    line: detail?.line ?? detail?.textRange?.startLine ?? hotspot.line ?? hotspot.textRange?.startLine ?? null,
    securityCategory: rule?.securityCategory ?? hotspot.securityCategory,
    vulnerabilityProbability: rule?.vulnerabilityProbability ?? hotspot.vulnerabilityProbability,
    riskDescription: normalizeText(rule?.riskDescription),
    vulnerabilityDescription: normalizeText(rule?.vulnerabilityDescription),
    fixRecommendations: normalizeText(rule?.fixRecommendations),
  };
}

async function fetchSonarJson<T>(apiUrl: string): Promise<SonarFetchResult<T>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SONAR_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(apiUrl, { signal: controller.signal });
    if (!response.ok) {
      return { ok: false, status: response.status };
    }
    return {
      ok: true,
      status: response.status,
      data: (await response.json()) as T,
    };
  } catch {
    return { ok: false, status: null };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchSonarNewIssues(projectKey: string, prNumber: number, sonarcloudUrl: string): Promise<SonarNewIssuesResult> {
  const apiUrl =
    `https://sonarcloud.io/api/issues/search` +
    `?componentKeys=${encodeURIComponent(projectKey)}&pullRequest=${String(prNumber)}&resolved=false&ps=1`;
  const response = await fetchSonarJson<{ paging?: { total?: number } }>(apiUrl);
  if (!response.ok) {
    if (response.status === 401) {
      return {
        total: null,
        note: `SonarCloud project is private. Open the Sonar URL in an authenticated browser: ${sonarcloudUrl}`,
      };
    }
    return {
      total: null,
      note: "SonarCloud new-issue count is unavailable right now.",
    };
  }

  if (typeof response.data.paging?.total === "number") {
    return { total: response.data.paging.total };
  }

  return {
    total: null,
    note: "SonarCloud did not return a new-issue count for this pull request.",
  };
}

async function fetchSonarGateViolations(projectKey: string, prNumber: number): Promise<SonarFetchResult<SonarFailureSummary>> {
  const apiUrl =
    `https://sonarcloud.io/api/qualitygates/project_status` +
    `?projectKey=${encodeURIComponent(projectKey)}&pullRequest=${String(prNumber)}`;
  const response = await fetchSonarJson<SonarProjectStatusResponse>(apiUrl);
  if (!response.ok) {
    return response;
  }

  const projectStatus = response.data.projectStatus;
  const gateViolations = (projectStatus?.conditions ?? [])
    .filter((condition) => condition.status !== undefined && condition.status !== "OK")
    .map((condition) => ({
      metricKey: condition.metricKey ?? "unknown",
      status: condition.status ?? "ERROR",
      comparator: condition.comparator,
      actualValue: condition.actualValue,
      errorThreshold: condition.errorThreshold,
    }));

  return {
    ok: true,
    status: response.status,
    data: {
      status: "available",
      qualityGateStatus: projectStatus?.status,
      gateViolations,
      issues: [],
      securityHotspots: [],
    },
  };
}

async function fetchSonarIssues(projectKey: string, prNumber: number): Promise<SonarFetchResult<{ total: number | null; issues: SonarIssue[] }>> {
  const pageSize = 100;
  const issues: SonarIssue[] = [];
  const components = new Map<string, string>();
  const rules = new Map<string, string>();
  let page = 1;
  let total: number | null = null;

  while (true) {
    const apiUrl =
      `https://sonarcloud.io/api/issues/search` +
      `?componentKeys=${encodeURIComponent(projectKey)}` +
      `&pullRequest=${String(prNumber)}` +
      `&resolved=false` +
      `&ps=${String(pageSize)}` +
      `&p=${String(page)}` +
      `&additionalFields=_all`;

    const response = await fetchSonarJson<SonarIssuesSearchResponse>(apiUrl);
    if (!response.ok) {
      return response;
    }

    const paging = response.data.paging;
    total ??= paging?.total ?? null;

    mapSonarIssuesPage(response.data, issues, components, rules);

    const fetchedCount = page * (paging?.pageSize ?? pageSize);
    if (paging?.total === undefined || fetchedCount >= paging.total) {
      break;
    }
    page += 1;
  }

  return {
    ok: true,
    status: 200,
    data: {
      total,
      issues,
    },
  };
}

async function fetchSonarHotspotDetail(hotspotKey: string): Promise<SonarFetchResult<SonarHotspotShowResponse>> {
  const apiUrl = `https://sonarcloud.io/api/hotspots/show?hotspot=${encodeURIComponent(hotspotKey)}`;
  return fetchSonarJson<SonarHotspotShowResponse>(apiUrl);
}

async function fetchSonarHotspots(projectKey: string, prNumber: number): Promise<SonarFetchResult<SonarSecurityHotspot[]>> {
  const pageSize = 100;
  const rawHotspots: RawSonarHotspot[] = [];
  const components = new Map<string, string>();
  let page = 1;

  while (true) {
    const apiUrl =
      `https://sonarcloud.io/api/hotspots/search` +
      `?projectKey=${encodeURIComponent(projectKey)}` +
      `&pullRequest=${String(prNumber)}` +
      `&onlyMine=false` +
      `&sinceLeakPeriod=true` +
      `&ps=${String(pageSize)}` +
      `&p=${String(page)}`;

    const response = await fetchSonarJson<SonarHotspotsSearchResponse>(apiUrl);
    if (!response.ok) {
      return response;
    }

    const paging = response.data.paging;
    mapSonarHotspotsPage(response.data, rawHotspots, components);

    const fetchedCount = page * (paging?.pageSize ?? pageSize);
    if (paging?.total === undefined || fetchedCount >= paging.total) {
      break;
    }
    page += 1;
  }

  const detailResults = await Promise.all(rawHotspots.map((hotspot) => fetchSonarHotspotDetail(hotspot.key ?? "")));
  const securityHotspots: SonarSecurityHotspot[] = [];

  for (let index = 0; index < rawHotspots.length; index += 1) {
    const hotspot = rawHotspots[index];
    const detailResult = detailResults[index];
    if (detailResult && !detailResult.ok && detailResult.status === 401) {
      return detailResult;
    }
    securityHotspots.push(mapSonarHotspot(hotspot, components, detailResult?.ok ? detailResult.data : undefined));
  }

  return {
    ok: true,
    status: 200,
    data: securityHotspots,
  };
}

function sonarPrivateFailureSummary(sonarcloudUrl: string): SonarFailureSummary {
  return {
    status: "private",
    gateViolations: [],
    issues: [],
    securityHotspots: [],
    privateMessage: `SonarCloud project is private. Open the Sonar URL in an authenticated browser: ${sonarcloudUrl}`,
  };
}

async function fetchSonarFailureSummary(
  projectKey: string,
  prNumber: number,
  sonarcloudUrl: string,
): Promise<SonarFailureSummaryResult> {
  const [gateResult, issuesResult, hotspotsResult] = await Promise.all([
    fetchSonarGateViolations(projectKey, prNumber),
    fetchSonarIssues(projectKey, prNumber),
    fetchSonarHotspots(projectKey, prNumber),
  ]);

  if (!gateResult.ok && gateResult.status === 401) {
    return {
      summary: sonarPrivateFailureSummary(sonarcloudUrl),
      issueTotal: null,
      issueNote: `SonarCloud project is private. Open the Sonar URL in an authenticated browser: ${sonarcloudUrl}`,
    };
  }
  if (!issuesResult.ok && issuesResult.status === 401) {
    return {
      summary: sonarPrivateFailureSummary(sonarcloudUrl),
      issueTotal: null,
      issueNote: `SonarCloud project is private. Open the Sonar URL in an authenticated browser: ${sonarcloudUrl}`,
    };
  }
  if (!hotspotsResult.ok && hotspotsResult.status === 401) {
    return {
      summary: sonarPrivateFailureSummary(sonarcloudUrl),
      issueTotal: null,
      issueNote: `SonarCloud project is private. Open the Sonar URL in an authenticated browser: ${sonarcloudUrl}`,
    };
  }

  const gateViolations = gateResult.ok ? gateResult.data.gateViolations : [];
  const issues = issuesResult.ok ? issuesResult.data.issues : [];
  const securityHotspots = hotspotsResult.ok ? hotspotsResult.data : [];
  const qualityGateStatus = gateResult.ok ? gateResult.data.qualityGateStatus : undefined;
  const issueTotal = issuesResult.ok ? issuesResult.data.total : null;
  const issueNote = issuesResult.ok ? undefined : "SonarCloud new-issue count is unavailable right now.";

  if (gateViolations.length === 0 && issues.length === 0 && securityHotspots.length === 0 && !qualityGateStatus) {
    return {
      summary: {
        status: "unavailable",
        gateViolations: [],
        issues: [],
        securityHotspots: [],
        unavailableMessage: "SonarCloud failure details are unavailable right now.",
      },
      issueTotal,
      issueNote,
    };
  }

  return {
    summary: {
      status: "available",
      qualityGateStatus,
      gateViolations,
      issues,
      securityHotspots,
    },
    issueTotal,
    issueNote,
  };
}

async function getPrInfoGh(branch: string): Promise<PrInfo | null> {
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

  const statusChecks = raw.statusCheckRollup ?? [];
  const failedChecks = statusChecks.filter(
    (c) => c.conclusion !== null && ["FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "CANCELLED"].includes(c.conclusion),
  );
  const sonarNeedsCheckRunOutput = statusChecks.some(
    (c) => (isSonarUrl(c.detailsUrl) || c.name.toLowerCase().includes("sonar")) && !extractSonarProjectKey(c.detailsUrl),
  );
  const ownerRepo = failedChecks.length > 0 || sonarNeedsCheckRunOutput ? parseOwnerRepo() : null;
  const checkOutputs = ownerRepo ? fetchCheckRunOutputs(ownerRepo, raw.headRefOid) : new Map();

  const checks: PrCheck[] = statusChecks.map((c) => {
    const enriched = checkOutputs.get(c.name);
    return {
      name: c.name,
      status: c.status,
      conclusion: c.conclusion,
      description: enriched?.title || c.description || "",
      detailsUrl: enriched?.detailsUrl || c.detailsUrl || "",
    };
  });

  // SonarCloud detection
  const sonarCheck = checks.find((c) => isSonarUrl(c.detailsUrl));
  let sonarcloudUrl: string | undefined;
  let sonarNewIssues: number | null | undefined;
  let sonarNewIssuesNote: string | undefined;
  let sonarFailures: SonarFailureSummary | undefined;
  if (sonarCheck) {
    sonarcloudUrl = resolveSonarPullRequestUrl(sonarCheck.detailsUrl, raw.number);
    const projectKey = extractSonarProjectKey(sonarcloudUrl);
    if (projectKey) {
      if (sonarCheck.conclusion !== null && SONAR_FAIL_CONCLUSIONS.has(sonarCheck.conclusion)) {
        const sonarSummary = await fetchSonarFailureSummary(projectKey, raw.number, sonarcloudUrl);
        sonarFailures = sonarSummary.summary;
        sonarNewIssues = sonarSummary.issueTotal;
        sonarNewIssuesNote = sonarSummary.issueNote;
      } else {
        const sonarNewIssuesResult = await fetchSonarNewIssues(projectKey, raw.number, sonarcloudUrl);
        sonarNewIssues = sonarNewIssuesResult.total;
        sonarNewIssuesNote = sonarNewIssuesResult.note;
      }
    } else {
      sonarNewIssues = null;
      sonarNewIssuesNote = "Could not determine the SonarCloud project key from the check URL.";
    }
  }

  return {
    number: raw.number,
    title: raw.title,
    state: raw.state,
    url: raw.url,
    checks,
    ...(sonarcloudUrl === undefined ? {} : { sonarcloudUrl, sonarNewIssues, sonarNewIssuesNote }),
    ...(sonarFailures === undefined ? {} : { sonarFailures }),
  };
}

export async function getPrInfo(branch: string): Promise<PrInfo | null> {
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

export type PrCommentsResult =
  | { ok: true; branch: string; comments: PrComment[] }
  | { ok: false; kind: "unsupported" }
  | { ok: false; kind: "no-pr"; branch: string }
  | { ok: false; kind: "error"; message: string };

export function resolveCurrentBranchComments(): PrCommentsResult {
  let branch: string;
  try {
    branch = getCurrentBranch();
  } catch (err) {
    return { ok: false, kind: "error", message: (err as Error).message };
  }
  let raw: PrComment[] | null | "unsupported";
  try {
    raw = getPrComments(branch);
  } catch (err) {
    return { ok: false, kind: "error", message: (err as Error).message };
  }
  if (raw === "unsupported") return { ok: false, kind: "unsupported" };
  if (raw === null) return { ok: false, kind: "no-pr", branch };
  return { ok: true, branch, comments: raw };
}

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function getLatestTagOnMaster(): string | null {
  const { stdout, status } = run("git", [
    "describe", "--tags", "--abbrev=0",
    "--match", "[0-9]*.[0-9]*.[0-9]*",
    "--match", "v[0-9]*.[0-9]*.[0-9]*",
    "master",
  ]);
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
  const { stdout, status, stderr } = run("git", ["tag", "-l", version]);
  if (status !== 0) {
    throw new Error(`Command failed: git tag -l ${version}\n${stderr.trim()}`);
  }
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
