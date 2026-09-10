import { Command } from "commander";
import {
  readConfig,
  DEFAULT_DO_WORK,
  DEFAULT_DO_WORK_ISSUE_DISCUSS_PROMPT,
  DEFAULT_DO_WORK_PR_WORK_PROMPT,
  DEFAULT_DO_WORK_PR_ORPHAN_PROMPT,
  type AutomataConfig,
  type DoWorkEffort,
  type DoWorkModels,
  type Executor,
  type TurnKind,
} from "../config/configStore.js";
import { addClosesRefToPr, getCurrentBranchPr, type GitHubIssue } from "../config/githubService.js";
import {
  assignIssueToAgent,
  assignPrToAgent,
  deleteMarker,
  getIssueSurface,
  getOpenPrLinkMap,
  getPrSurface,
  getAuthenticatedLogin,
  getRepoSlug,
  listCandidateIssues,
  postMarker,
  updateMarker,
  type MarkerRef,
  type IssueSurface,
  type OpenPrLinkMap,
  type OrphanPr,
} from "../github/ghWorkService.js";
import type { RawMessage, Participants } from "../github/conversation.js";
import {
  claimStates,
  decideOrphanPrWork,
  decideWork,
  selectLinkedPr,
  skipDuplicateHeadBranches,
  type Decision,
  type IssueState,
  type WorkItem,
} from "../github/workDetection.js";
import { composePrompt } from "../github/workPrompt.js";
import {
  describeExecution,
  describeInvalidTool,
  parseRunDirective,
  resolveExecution,
  triggeringMessage,
  type ResolvedExecution,
  type ResolveExecutionResult,
} from "../github/runDirective.js";
import {
  analyseAnswer,
  messagesBetween,
  promptWatermark,
  type AnswerAnalysis,
} from "../github/markerReconciliation.js";
import { prepareBaseBranch, preparePrBranch } from "../git/workspaceService.js";
import { runRepoHygiene, type HygieneReport, type PruneOutcome } from "../git/repoHygiene.js";
import { getCurrentBranch } from "../git/gitService.js";
import { acquireRunLock, RUN_LOCK_RELATIVE_PATH, type LockHandle } from "../run/runLock.js";
import { recordTick, type TickLogItem } from "../run/operationLog.js";
import { runClaude, buildClaudeArgs, resolveCommand } from "../claude/claudeService.js";
import { runCodex, buildCodexArgs } from "../codex/codexService.js";
import { terminateTrackedChildren } from "../cli/childRegistry.js";
import { shellQuote, resolveEffortOption } from "../cli/spawnUtils.js";

type Outcome = "answered" | "answered-no-reply" | "skipped" | "failed" | "deferred";

/**
 * The marker of the item currently running, so an interrupted tick can explain
 * itself. Without this, `SIGTERM` exits with a `working…` comment still in place
 * holding the boundary, and the message behind it is never answered — with
 * nothing on GitHub saying why.
 */
let inFlightMarker: { marker: MarkerRef; item: WorkItem } | null = null;

interface DoWorkOptions {
  with?: string;
  model?: string;
  effort?: string;
  issue?: string;
  pr?: string;
  limit: string;
  maxRuns?: string;
  dryRun?: boolean;
  json?: boolean;
  silent?: boolean;
}

interface Settings {
  baseBranch: string;
  protectedBranches: string[];
  /**
   * The inputs to the per-item executor/model resolution, not the answer: the
   * newest message on each item can override both, so the effective values are
   * resolved per work item rather than once per tick.
   */
  withOption: Executor | undefined;
  modelOption: string | undefined;
  configExecutor: Executor | undefined;
  configModels: DoWorkModels | undefined;
  effortOption: string | undefined;
  configEfforts: DoWorkEffort | undefined;
  maxRuns: number;
  lockStaleMinutes: number;
  limit: number;
  participants: Participants;
  prompts: Record<TurnKind, string>;
  technique: NonNullable<AutomataConfig["issueDiscoveryTechnique"]>;
  discoveryValue: string;
  onlyIssue: number | undefined;
  onlyPr: number | undefined;
}

interface ItemReport {
  /** Null for a `pr-orphan` item: there is no issue. */
  issue: number | null;
  /** The pull request the item is about, or null for a discussion turn. */
  pr: number | null;
  title: string;
  turn: TurnKind | null;
  outcome: Outcome;
  detail: string;
  /** True only when the executor was actually invoked — what the run cap counts. */
  ranExecutor?: boolean;
  /** Present once the item got far enough for the executor and model to be resolved. */
  execution?: ResolvedExecution;
}

/**
 * How an item or a skip is named in the plan, the progress lines, the summary
 * and the work log.
 *
 * A `pr-orphan` item has no issue, and a bare `#61` would be indistinguishable
 * from issue 61 in a log an operator reads out of cron mail. The work log takes
 * the label from here rather than formatting its own, so a line in
 * `automata-work.log` names an item exactly as the tick's stdout did.
 */
function subjectLabel(issue: number | null, pr: number | null): string {
  if (issue !== null) return `#${String(issue)}`;
  // Every decision carries one or the other; the last branch keeps this total.
  return pr === null ? "#?" : `PR #${String(pr)}`;
}

function itemLabel(item: WorkItem): string {
  return subjectLabel(item.issue?.number ?? null, item.pr?.number ?? null);
}

/** The same label for a finished item, whose numbers are already flattened. */
function reportLabel(report: ItemReport): string {
  return subjectLabel(report.issue, report.pr);
}

/** The item's own title: the issue's, or the pull request's when there is none. */
function itemTitle(item: WorkItem): string {
  return item.issue?.title ?? item.pr?.title ?? "";
}

/** stdout carries the plan and the summary; stderr carries progress and warnings. */
function out(message: string): void {
  process.stdout.write(message);
}

function progress(message: string): void {
  process.stderr.write(message);
}

/**
 * The current invocation, for the benefit of `fail()`.
 *
 * Null for a dry run and until the action starts, so nothing is logged for an
 * invocation that is not meant to leave a trace.
 */
let loggableInvocation: { startedAt: number } | null = null;

function fail(message: string): never {
  process.stderr.write(`Error: ${message}\n`);
  // Every `fail()` is a pre-flight misconfiguration that exits before the tick
  // begins. Without a line here a loop that stopped working because someone
  // edited `.automata/config.json` looks exactly like cron having stopped
  // firing — the one confusion the execution log exists to remove.
  if (loggableInvocation !== null) {
    const { startedAt } = loggableInvocation;
    loggableInvocation = null;
    logTick([], 1, startedAt, "config-error");
  }
  process.exit(1);
}

/**
 * Parse the whole token, not a prefix of it.
 *
 * `Number.parseInt` accepts "42junk" and "3.5", which for `--issue` means
 * silently targeting a different issue than the operator typed.
 */
function parsePositiveInt(value: string, label: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    fail(`${label} must be a positive integer (got "${value}").`);
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    fail(`${label} must be a positive integer within the safe range (got "${value}").`);
  }
  return parsed;
}

function resolveSettings(options: DoWorkOptions): Settings {
  let config: AutomataConfig;
  try {
    config = readConfig();
  } catch (err) {
    // A configured prompt that cannot be resolved is fatal rather than falling
    // back to the built-in default: on an unattended loop a silent fallback
    // would change agent behaviour invisibly.
    fail((err as Error).message);
  }

  if (config.remoteType !== "gh") {
    fail(
      "do-work is only supported for GitHub remotes. Set it with `automata config set type gh`. " +
        "Azure DevOps lacks the issue conversation APIs this needs — see docs/azdo-gap.md.",
    );
  }

  if (!config.issueDiscoveryTechnique) {
    fail("No issue discovery technique configured. Run `automata config set issue-discovery-technique <value>`.");
  }
  if (!config.issueDiscoveryValue) {
    fail("No issue discovery value configured. Run `automata config set issue-discovery-value <value>`.");
  }

  const allowedUsers = (config.allowedUsers ?? []).filter((user) => user.trim().length > 0);
  if (allowedUsers.length === 0) {
    fail("No allowed users configured. Run `automata config set allowed-users <user1,user2>`.");
  }

  const agentUser = (config.agentUser ?? "").trim();
  if (agentUser.length === 0) {
    fail("No agent user configured. Run `automata config set agent-user <login>`.");
  }

  validateDoWorkConfig((config as { doWork?: unknown }).doWork);
  const doWork = config.doWork ?? {};

  let withOption: Executor | undefined;
  if (options.with !== undefined) {
    const requested = options.with.toLowerCase();
    if (requested !== "claude" && requested !== "codex") {
      fail(`--with must be 'claude' or 'codex', got '${options.with}'.`);
    }
    withOption = requested;
  }

  // A dry run posts nothing, so the identity that would post is irrelevant; the
  // guard must not block the primary diagnostic.
  if (options.dryRun !== true) {
    checkAuthenticatedIdentity(agentUser, allowedUsers);
  }

  return {
    baseBranch: doWork.baseBranch ?? DEFAULT_DO_WORK.baseBranch,
    protectedBranches: doWork.protectedBranches ?? DEFAULT_DO_WORK.protectedBranches,
    withOption,
    modelOption: options.model,
    configExecutor: doWork.executor,
    configModels: doWork.models,
    // Rejected here rather than per item: an empty `--effort` is an operator
    // mistake on this invocation, not a property of any one work item. The
    // configured per-executor defaults are trimmed inside `resolveExecution`,
    // which is where the executor in use is finally known.
    effortOption: resolveEffortOption(options.effort),
    configEfforts: doWork.effort,
    maxRuns:
      options.maxRuns !== undefined
        ? parsePositiveInt(options.maxRuns, "--max-runs")
        : (doWork.maxRunsPerTick ?? DEFAULT_DO_WORK.maxRunsPerTick),
    lockStaleMinutes: doWork.lockStaleMinutes ?? DEFAULT_DO_WORK.lockStaleMinutes,
    limit: parsePositiveInt(options.limit, "--limit"),
    participants: { allowedUsers, agentUser },
    prompts: {
      "issue-discuss": doWork.prompts?.issueDiscuss ?? DEFAULT_DO_WORK_ISSUE_DISCUSS_PROMPT,
      "pr-work": doWork.prompts?.prWork ?? DEFAULT_DO_WORK_PR_WORK_PROMPT,
      "pr-orphan": doWork.prompts?.prOrphan ?? DEFAULT_DO_WORK_PR_ORPHAN_PROMPT,
    },
    technique: config.issueDiscoveryTechnique,
    discoveryValue: config.issueDiscoveryValue,
    onlyIssue: options.issue === undefined ? undefined : parsePositiveInt(options.issue, "--issue"),
    onlyPr: options.pr === undefined ? undefined : parsePositiveInt(options.pr, "--pr"),
  };
}

/**
 * Refuse to run as an account that is allowed to instruct the agent.
 *
 * Everything the agent posts — the marker especially — is attributed to whoever
 * `gh` is authenticated as. If that account is in `allowedUsers`, the marker
 * itself reads as a new instruction, so every tick would answer the marker left
 * by the previous tick: an unbounded self-triggering loop, and the one
 * misconfiguration the marker design cannot defend against.
 *
 * Any *known* mismatch is fatal, not just an authorized one: a marker posted
 * under an account that is neither the agent nor authorized is filtered out of
 * the conversation entirely, so the boundary never advances and the same message
 * starts a run on every tick. Only an *unverifiable* login proceeds, with a
 * warning — a GitHub App installation token legitimately has no user.
 */
function checkAuthenticatedIdentity(agentUser: string, allowedUsers: string[]): void {
  const login = getAuthenticatedLogin();
  if (login === null) {
    progress(
      "Warning: could not determine which account `gh` is authenticated as; " +
        `assuming it is the agent (${agentUser}).\n`,
    );
    return;
  }

  if (login.toLowerCase() === agentUser.toLowerCase()) return;

  if (allowedUsers.some((user) => user.toLowerCase() === login.toLowerCase())) {
    fail(
      `\`gh\` is authenticated as "${login}", which is listed in allowedUsers. ` +
        `Everything do-work posts would be attributed to an account that is allowed to instruct the agent, ` +
        `so its own marker comment would look like a new instruction and each tick would answer the previous tick forever. ` +
        `Authenticate \`gh\` as the agent account (${agentUser}) in this environment, or correct \`agentUser\`.`,
    );
  }

  // Any known mismatch is fatal, not just an authorized one. The marker would be
  // posted by an account that is neither the agent nor authorized, so the
  // conversation filter drops it entirely: the boundary never advances and the
  // same human message starts a model run on every tick. Only the unverifiable
  // case below is allowed to proceed.
  fail(
    `\`gh\` is authenticated as "${login}" but agentUser is "${agentUser}". ` +
      "Comments posted under that identity are neither the agent's nor an authorized user's, so they are " +
      "filtered out of the conversation: the answer boundary would never advance and the same message would " +
      "start a run on every tick. " +
      `Authenticate \`gh\` as the agent account (${agentUser}) in this environment, or correct \`agentUser\`.`,
  );
}

interface PlannedRun {
  prompt: string;
  bin: string;
  args: string[];
  /** The argv rendered as a shell-pasteable command line. */
  command: string;
}

/**
 * The executor and model for one work item.
 *
 * Per item, not per tick: the newest authorized message the turn answers may
 * carry `tool:` / `model:`, and a tick answers several issues with their own
 * newest messages. `Settings` therefore holds the inputs and this holds the
 * answer, so no item can leak its choice into the next one.
 */
function resolveItemExecution(item: WorkItem, settings: Settings): ReturnType<typeof resolveExecution> {
  const trigger = triggeringMessage(item);
  return resolveExecution({
    directive: trigger === null ? { tool: undefined, model: undefined } : parseRunDirective(trigger.body),
    withOption: settings.withOption,
    modelOption: settings.modelOption,
    configExecutor: settings.configExecutor,
    configModels: settings.configModels,
    effortOption: settings.effortOption,
    configEfforts: settings.configEfforts,
    defaultExecutor: DEFAULT_DO_WORK.executor,
  });
}

/**
 * Drop the `ok` discriminant, leaving just the resolved values. Written once so
 * the real run and the dry run cannot disagree; the declared return type makes
 * a field added to `ResolvedExecution` and forgotten here a compile error.
 */
function toExecution(resolved: Extract<ResolveExecutionResult, { ok: true }>): ResolvedExecution {
  return {
    executor: resolved.executor,
    executorSource: resolved.executorSource,
    model: resolved.model,
    modelSource: resolved.modelSource,
    effort: resolved.effort,
    effortSource: resolved.effortSource,
  };
}

/**
 * What would be executed for a work item, built with the same argv builders the
 * real invocation uses so `--dry-run` cannot drift from what actually happens.
 */
function planRun(item: WorkItem, settings: Settings, execution: ResolvedExecution): PlannedRun {
  const prompt = composePrompt({
    item,
    repo: getRepoSlug(),
    agentUser: settings.participants.agentUser,
    baseBranch: settings.baseBranch,
    frame: settings.prompts[item.turn],
  });

  // The resolved path, not the bare name: this is literally what gets spawned.
  const bin = resolveCommand(execution.executor === "codex" ? "codex" : "claude");
  // `verbose: true` unconditionally, because `runClaude` always streams so the
  // child stays cancellable; `--silent` suppresses printing, not the flags.
  const args =
    execution.executor === "codex"
      ? buildCodexArgs(prompt, { yolo: true, model: execution.model, effort: execution.effort })
      : buildClaudeArgs(prompt, {
          yolo: true,
          verbose: true,
          model: execution.model,
          effort: execution.effort,
        });

  return { prompt, bin, args, command: [bin, ...args].map(shellQuote).join(" ") };
}

/**
 * What the tick would do to the assignee lists, per surface: the `Assign` line
 * of a dry run's per-item block.
 *
 * Every surface the item has is named, in whichever state it is in: "already
 * assigned" for a surface nobody would touch is the answer an operator auditing
 * an unattended tick needs, and silence there would read as "the claim was
 * forgotten". The plan line is terser — see `describePlanClaim`.
 */
function describeAssignment(item: WorkItem, agentUser: string): string {
  return claimStates(item)
    .map((claim) => {
      // The issue needs no number here: it is the block's own heading.
      const label = claim.surface === "issue" ? "issue" : `pull request #${String(claim.number)}`;
      switch (claim.state) {
        case "would-claim":
          return `would assign ${label} to ${agentUser}`;
        case "already-assigned":
          return `${label} already assigned`;
        case "rule-exempt":
          // Never claimed, by design — see the `prNeedsAssignment` note on the
          // orphan item in `workDetection.ts`.
          return `${label} not claimed (orphan pass)`;
      }
    })
    .join(" · ");
}

/**
 * The claim suffix of a plan line.
 *
 * "Already assigned" stays unsaid: the plan is one line per candidate, and a
 * state the tick does not act on does not earn the width — the absence of
 * "will assign" is the answer. An **exemption** is said out loud, because it is
 * a rule rather than a state: an operator auditing an unattended tick would
 * otherwise read the silence on an orphan pull request as "somebody is already
 * on it", when in fact nobody is and nobody ever will be.
 */
function describePlanClaim(item: WorkItem): string {
  const claims = claimStates(item);
  const would = claims.filter((claim) => claim.state === "would-claim").map((claim) => `the ${claim.surface}`);
  const exempt = claims.filter((claim) => claim.state === "rule-exempt").map((claim) => claim.surface);
  const parts: string[] = [];
  if (would.length > 0) parts.push(`will assign ${would.join(" and ")} to the agent`);
  if (exempt.length > 0) parts.push(`${exempt.join(" and ")} not claimed (orphan pass)`);
  return parts.length === 0 ? "" : `, ${parts.join(", ")}`;
}

/** The per-item summary header printed above the command on a dry run. */
function describePlannedRun(
  item: WorkItem,
  settings: Settings,
  run: PlannedRun,
  execution: ResolvedExecution,
): string {
  const rule = "─".repeat(72);
  const branchAction = item.turn === "issue-discuss" ? " and pull" : " and fast-forward";
  const assignment = describeAssignment(item, settings.participants.agentUser);
  const markerTarget = markerSurfaceLabel(item);
  const lines = [
    rule,
    describeSubject(item),
    rule,
    `  Turn         ${item.turn}`,
    `  Why          ${item.reason}`,
    `  Branch       ${item.branch} (would check out${branchAction})`,
    `  Assign       ${assignment}`,
    `  Marker       would post on ${markerTarget}`,
    `  Executor     ${describeExecution(execution)}`,
    "  Permissions  bypassed (do-work always runs unattended)",
    `  Prompt       ${String(run.prompt.length)} chars — frame + assembled context`,
    "",
    "  Command that would be launched:",
    // Printed flush-left and unindented on purpose: the prompt is a multi-line
    // quoted argument, so indenting the continuation lines would inject leading
    // whitespace into the prompt itself and the command would no longer be the
    // one that runs.
    rule,
    run.command,
    rule,
    "",
  ];
  return lines.join("\n") + "\n";
}

/** The heading of an item's dry-run block: the issue, or the pull request when there is none. */
function describeSubject(item: WorkItem): string {
  return item.issue !== null
    ? `Issue #${String(item.issue.number)} — ${item.issue.title}`
    : `Pull request #${String(item.pr?.number ?? 0)} — ${itemTitle(item)}`;
}

/** The dry-run header for an item a real tick would refuse without invoking anything. */
function describeRefusedRun(item: WorkItem, refusal: string): string {
  const rule = "─".repeat(72);
  return (
    [
      rule,
      describeSubject(item),
      rule,
      `  Turn         ${item.turn}`,
      `  Why          ${item.reason}`,
      `  Executor     refused — ${refusal}`,
      "  Command      none; a real tick would post the working marker and then replace it with this refusal",
      "",
    ].join("\n") + "\n"
  );
}

/**
 * Check the hand-edited parts of `.automata/config.json`.
 *
 * The types say these fields are well formed; the file on disk makes no such
 * promise. An unrecognised executor used to fall through to Claude, and a
 * negative run cap used to read as unlimited — both silent, on an unattended
 * loop, which is the worst place for a silent misreading.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A field that must be a non-empty string if present at all. */
function validateOptionalString(container: Record<string, unknown>, key: string, path: string): void {
  const value = container[key];
  if (value === undefined || value === null) return;
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${path} must be a non-empty string.`);
  }
}

function validateOptionalInt(
  container: Record<string, unknown>,
  key: string,
  path: string,
  min: number,
  hint: string,
): void {
  const value = container[key];
  if (value === undefined || value === null) return;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) {
    fail(`${path} must be ${hint}, got ${JSON.stringify(value)}.`);
  }
}

function validateDoWorkConfig(section: unknown): void {
  // Read as untrusted JSON, not as the declared type: the file is hand-edited,
  // so `{"prompts": "custom.md"}` would otherwise be silently accepted (falling
  // back to the built-in prompts) and a numeric `baseBranch` would throw from
  // `.trim()` instead of producing the actionable error this promises.
  if (section === undefined || section === null) return;
  if (!isPlainObject(section)) {
    fail(`doWork must be an object, got ${JSON.stringify(section)}.`);
  }

  const executor = section["executor"];
  if (executor !== undefined && executor !== "claude" && executor !== "codex") {
    fail(`doWork.executor must be 'claude' or 'codex', got ${JSON.stringify(executor)}.`);
  }

  validateOptionalString(section, "baseBranch", "doWork.baseBranch");
  validateOptionalInt(section, "maxRunsPerTick", "doWork.maxRunsPerTick", 0, "a non-negative integer (0 = unlimited)");
  validateOptionalInt(section, "lockStaleMinutes", "doWork.lockStaleMinutes", 1, "a positive integer");

  validateProtectedBranches(section["protectedBranches"]);
  validateSettingContainer(section["models"], "models", ["claude", "codex"]);
  validateSettingContainer(section["effort"], "effort", ["claude", "codex"]);
  validateSettingContainer(section["prompts"], "prompts", ["issueDiscuss", "prWork", "prOrphan"]);
}

function validateProtectedBranches(value: unknown): void {
  if (value === undefined || value === null) return;
  const isNonEmptyString = (b: unknown): boolean => typeof b === "string" && b.trim().length > 0;
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    fail("doWork.protectedBranches must be an array of non-empty strings.");
  }
}

function validateSettingContainer(value: unknown, container: string, keys: string[]): void {
  if (value === undefined || value === null) return;
  if (!isPlainObject(value)) {
    fail(`doWork.${container} must be an object, got ${JSON.stringify(value)}.`);
  }
  for (const key of keys) {
    validateOptionalString(value, key, `doWork.${container}.${key}`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) {
      fail(`doWork.${container}.${key} is not a recognised setting; expected one of: ${keys.join(", ")}.`);
    }
  }
}

/**
 * Does the issue pass run at all?
 *
 * `--pr N` on its own means "this pull request", so listing issues as well would
 * contradict the option. Given both `--issue` and `--pr`, both passes run, each
 * restricted to what was named.
 */
function issuePassEnabled(settings: Settings): boolean {
  return settings.onlyPr === undefined || settings.onlyIssue !== undefined;
}

/** The mirror of the above: `--issue N` on its own means "this issue". */
function orphanPassEnabled(settings: Settings): boolean {
  return settings.onlyIssue === undefined || settings.onlyPr !== undefined;
}

function discoverIssues(settings: Settings): GitHubIssue[] {
  if (!issuePassEnabled(settings)) return [];
  const candidates = listCandidateIssues(settings.technique, settings.discoveryValue, settings.limit);

  if (settings.onlyIssue === undefined) {
    if (candidates.length === settings.limit) {
      progress(
        `Note: fetched the maximum of ${String(settings.limit)} issues — there may be more. Use --limit to raise it.\n`,
      );
    }
    return candidates;
  }

  const match = candidates.find((issue) => issue.number === settings.onlyIssue);
  if (match) return [match];

  // Absence from the candidate page is not proof of anything: a matching issue
  // beyond --limit would be reported as non-matching. Ask about this issue.
  const surface = getIssueSurface(settings.onlyIssue);
  if (!issueMatchesFilter(surface, settings)) {
    progress(
      `Note: issue #${String(settings.onlyIssue)} does not match the configured discovery filter ` +
        `(${settings.technique} = ${settings.discoveryValue}); processing it anyway because --issue was given.\n`,
    );
  }
  return [surface.issue];
}

/** The three fields the discovery filter can read, off an issue or off a pull request. */
interface DiscoverySubject {
  labels: string[];
  assignees: string[];
  title: string;
}

/**
 * Does this issue or pull request satisfy the configured discovery filter?
 *
 * One function for both passes deliberately: the orphan pass uses the same
 * `issueDiscoveryTechnique` / `issueDiscoveryValue` as the issue pass — there is
 * no second configuration key — so the two must not be able to interpret the
 * same setting differently.
 */
function matchesDiscoveryFilter(subject: DiscoverySubject, settings: Settings): boolean {
  const value = settings.discoveryValue.toLowerCase();
  switch (settings.technique) {
    case "label":
      return subject.labels.some((label) => label.toLowerCase() === value);
    case "assignee":
      return subject.assignees.some((assignee) => assignee.toLowerCase() === value);
    case "title-contains":
      return subject.title.toLowerCase().includes(value);
  }
}

function issueMatchesFilter(surface: IssueSurface, settings: Settings): boolean {
  return matchesDiscoveryFilter(
    { labels: surface.labels, assignees: surface.assignees, title: surface.issue.title },
    settings,
  );
}

function prMatchesFilter(candidate: OrphanPr, settings: Settings): boolean {
  return matchesDiscoveryFilter(
    { labels: candidate.labels, assignees: candidate.assignees, title: candidate.pr.title },
    settings,
  );
}

/**
 * The issues of this repository a given pull request closes, read out of the
 * link map rather than from a fresh query.
 *
 * Written once because two callers ask it for opposite reasons: `--pr` needs it
 * to explain that a number belongs to the issue pass, and the pre-run refresh
 * needs it to notice that an item gained a closing reference mid-tick.
 */
function issuesClosedBy(linkMap: OpenPrLinkMap, prNumber: number): number[] {
  return [...linkMap.byIssue.entries()]
    .filter(([, prs]) => prs.some((pr) => pr.number === prNumber))
    .map(([issueNumber]) => issueNumber);
}

/**
 * The open pull requests of this repository that close no issue of it and match
 * the discovery filter.
 *
 * Costs no API call of its own: the candidates come out of the link map the tick
 * already pages through exhaustively. That exhaustiveness is also what makes
 * `--pr` answerable from the map alone — a number missing from it is not an open
 * pull request here, and one present but not orphaned belongs to the issue pass.
 */
function discoverOrphanPrs(settings: Settings, linkMap: OpenPrLinkMap): OrphanPr[] {
  if (!orphanPassEnabled(settings)) return [];

  if (settings.onlyPr === undefined) {
    return linkMap.orphans.filter((candidate) => prMatchesFilter(candidate, settings));
  }

  const target = settings.onlyPr;
  const match = linkMap.orphans.find((candidate) => candidate.pr.number === target);
  if (match === undefined) {
    // Thrown, not `fail()`ed: this runs inside the run lock and after the
    // pre-flight, so `process.exit` here would skip the `finally` that releases
    // the lock and leave every tick on another host idle until it goes stale.
    // The caller turns this into the same `Error: …` on stderr and exit 1.
    const closes = issuesClosedBy(linkMap, target);
    if (closes.length > 0) {
      throw new Error(
        `Pull request #${String(target)} closes issue #${String(closes[0])} of this repository, so it is not ` +
          `orphaned and the issue pass owns it. Use \`--issue ${String(closes[0])}\` instead.`,
      );
    }
    throw new Error(
      `#${String(target)} is not an open pull request of this repository. ` +
        "The orphan pass only ever works on open pull requests; use `--issue` for an issue.",
    );
  }

  if (!prMatchesFilter(match, settings)) {
    progress(
      `Note: pull request #${String(target)} does not match the configured discovery filter ` +
        `(${settings.technique} = ${settings.discoveryValue}); processing it anyway because --pr was given.\n`,
    );
  }
  return [match];
}

function buildIssueState(issue: GitHubIssue, linkMap: OpenPrLinkMap): IssueState {
  const issueSurface = getIssueSurface(issue.number);
  const linkedPrs = linkMap.byIssue.get(issue.number) ?? [];
  const selected = selectLinkedPr(linkedPrs);
  return {
    issueSurface,
    linkedPrs,
    prSurface: selected === null ? null : getPrSurface(selected.number),
  };
}

function describePlan(decisions: Decision[]): string {
  const lines = decisions.map((decision) => {
    if (decision.kind === "skip") {
      return (
        `  ${subjectLabel(decision.issue?.number ?? null, decision.pr?.number ?? null)} nothing to do — ${decision.detail}`
      );
    }
    const item = decision.item;
    return `  ${itemLabel(item)} ${item.turn} on ${item.branch} — ${item.reason}${describePlanClaim(item)}`;
  });
  return lines.length === 0 ? "  (nothing matched the discovery filter)\n" : lines.join("\n") + "\n";
}

/**
 * Add the agent as an assignee, so the claim is visible in the issue list.
 *
 * Only when the issue has *no* assignee. An issue somebody already owns keeps
 * its owner untouched: the assignee column then means "is anyone on this?" and
 * nothing else, which is what makes it readable at a glance.
 *
 * Advisory: a repository where the agent lacks write access must still be able
 * to run the loop, so a failure warns rather than stopping the turn.
 */
function claimIssue(item: WorkItem, settings: Settings): void {
  if (!item.needsAssignment || item.issue === null) return;
  try {
    assignIssueToAgent(item.issue.number, settings.participants.agentUser);
    progress(`  assigned issue #${String(item.issue.number)} to ${settings.participants.agentUser}.\n`);
  } catch (err) {
    progress(`  warning: could not assign issue #${String(item.issue.number)}: ${(err as Error).message}\n`);
  }
}

/**
 * The same claim on the pull request, so the pull request list reads like the
 * issue list. Same empty-list-only rule, same advisory failure.
 */
function claimPr(prNumber: number, agentUser: string): void {
  try {
    assignPrToAgent(prNumber, agentUser);
    progress(`  assigned pull request #${String(prNumber)} to ${agentUser}.\n`);
  } catch (err) {
    progress(`  warning: could not assign pull request #${String(prNumber)}: ${(err as Error).message}\n`);
  }
}

/**
 * Note on the issue that the work is happening on its pull request.
 *
 * The surfaces keep independent boundaries, so a build turn triggered by issue
 * messages must advance the issue's too — otherwise that comment starts another
 * build turn on every tick. Returns false when the note could not be posted, in
 * which case the caller must not proceed; the marker is withdrawn first so
 * neither boundary moves.
 */
function notePickupOnIssue(item: WorkItem, marker: MarkerRef): MarkerRef | null | false {
  // `pr-orphan` is excluded by the turn check: it has no issue to note on.
  if (item.turn !== "pr-work" || item.pr === null || item.issue === null) return null;
  if (!item.issueAnalysis.hasNewMessage) return null;
  try {
    return postMarker(
      "issue",
      item.issue.number,
      `automata do-work: picked this up on pull request #${String(item.pr.number)} — ${item.pr.url}`,
    );
  } catch (err) {
    progress(`  skipped: could not note the pickup on issue #${String(item.issue.number)} — ${(err as Error).message}\n`);
    try {
      deleteMarker(marker);
    } catch (deleteErr) {
      progress(`  warning: could not withdraw the working marker: ${(deleteErr as Error).message}\n`);
    }
    return false;
  }
}

/**
 * Report issue messages the pickup note buried.
 *
 * The note becomes the issue's newest agent message, so anything authorized that
 * arrived between reading the issue and posting the note is behind the boundary
 * and will never be new again — the same window the prompt watermark closes on
 * the answering surface, one surface over. Reconciliation only re-reads the pull
 * request, so without this those messages vanish unremarked.
 */
function reportIssueMessagesBuriedByNote(
  item: WorkItem,
  note: MarkerRef,
  participants: Participants,
): number {
  if (item.issue === null) return 0;
  const watermark = promptWatermark([item.issueAnalysis.messages]);
  let buried: RawMessage[];
  try {
    const messages = getIssueSurface(item.issue.number).messages;
    buried = messagesBetween(messages, participants, watermark, note.createdAt);
  } catch (err) {
    progress(`  warning: could not re-read issue #${String(item.issue.number)}: ${(err as Error).message}\n`);
    return 0;
  }
  if (buried.length === 0) return 0;

  const authors = [...new Set(buried.map((message) => message.author))].join(", ");
  try {
    postMarker(
      "issue",
      item.issue.number,
      `automata do-work: ${authors} posted here while this issue was being picked up, so ` +
        `${buried.length === 1 ? "that message was" : "those messages were"} not included in the run. ` +
        "Please post again to have them acted on.",
    );
  } catch (err) {
    progress(`  warning: could not report the buried issue message(s): ${(err as Error).message}\n`);
  }
  return buried.length;
}

/**
 * Re-decide one item against the current state of GitHub.
 *
 * Returns a skip when the issue has since been closed or answered, which is the
 * right outcome: the plan said there was work, and there no longer is.
 */
function refreshItem(item: WorkItem, settings: Settings): Decision {
  // The link map is re-fetched, not reused: if a pull request was opened for
  // this issue while an earlier item ran, the stale map would still say there is
  // none and we would run a discussion turn on the base branch — starting a
  // competing implementation against the branch that already exists.
  const linkMap = getOpenPrLinkMap();
  const policy = {
    baseBranch: settings.baseBranch,
    defaultBranch: linkMap.defaultBranch,
    protectedBranches: settings.protectedBranches,
  };

  if (item.issue === null) return refreshOrphanItem(item, linkMap, settings, policy);

  return decideWork(buildIssueState(item.issue, linkMap), settings.participants, policy);
}

/**
 * Re-decide an orphan pull-request item against the current state of GitHub.
 *
 * The same re-fetched link map answers one more question here: did the pull
 * request gain a closing reference while an earlier item ran? If it did, the
 * issue pass owns it now — running it with the orphan prompt would answer with
 * the wrong instructions — so it is skipped and the next tick picks it up on the
 * correct path.
 */
function refreshOrphanItem(
  item: WorkItem,
  linkMap: OpenPrLinkMap,
  settings: Settings,
  policy: { baseBranch: string; defaultBranch: string | null; protectedBranches: string[] },
): Decision {
  const number = item.pr?.number ?? 0;
  const stillOrphan = linkMap.orphans.some((candidate) => candidate.pr.number === number);
  if (!stillOrphan) {
    const linkedTo = issuesClosedBy(linkMap, number).map((issueNumber) => `#${String(issueNumber)}`);
    return {
      kind: "skip",
      issue: null,
      pr: item.pr,
      reason: linkedTo.length > 0 ? "pr-linked" : "pr-closed",
      detail:
        linkedTo.length > 0
          ? `pull request #${String(number)} now closes ${linkedTo.join(", ")}, so it is no longer orphaned`
          : `pull request #${String(number)} is no longer an open pull request of this repository`,
    };
  }
  return decideOrphanPrWork({ prSurface: getPrSurface(number) }, settings.participants, policy);
}

/** Re-read the surface the turn answered, flattened for the answer analysis. */
function readAnsweringSurface(item: WorkItem): RawMessage[] {
  const pr = item.pr;
  if (pr !== null && item.turn !== "issue-discuss") {
    const surface = getPrSurface(pr.number);
    return [...surface.messages, ...surface.threads.flatMap((thread) => thread.comments)];
  }
  // A discussion turn always has an issue; the guard keeps the function total.
  return item.issue === null ? [] : getIssueSurface(item.issue.number).messages;
}

/**
 * Which surface the turn answers. Both build turns answer on the pull request;
 * only a discussion turn answers on the issue.
 */
function markerSurfaceTarget(item: WorkItem): { surface: "issue" | "pr"; number: number } {
  return item.pr !== null && item.turn !== "issue-discuss"
    ? { surface: "pr", number: item.pr.number }
    : { surface: "issue", number: item.issue?.number ?? 0 };
}

/** The same target as prose, for marker text that points somewhere real. */
function markerSurfaceLabel(item: WorkItem): string {
  const target = markerSurfaceTarget(item);
  return target.surface === "pr"
    ? `pull request #${String(target.number)}`
    : `issue #${String(target.number)}`;
}

/**
 * Tell the humans about authorized messages the run overtook without seeing.
 *
 * A stateless boundary cannot carry them forward — the agent's answer is newer,
 * so the next tick will not see them as new. Nothing can recover them; the only
 * honest option is to say so and ask for a repost.
 */
function reportOvertakenMessages(item: WorkItem, analysis: AnswerAnalysis): void {
  if (analysis.missed.length === 0) return;
  const authors = [...new Set(analysis.toReport.map((message) => message.author))].join(", ");
  const count = analysis.toReport.length;
  const target = markerSurfaceTarget(item);
  try {
    postMarker(
      target.surface,
      target.number,
      `automata do-work: ${authors} posted here while this run was already in progress, so ` +
        `${count === 1 ? "that message was" : "those messages were"} not included in it. ` +
        "Please post again to have them acted on.",
    );
  } catch (err) {
    progress(`  warning: could not report the overtaken message(s): ${(err as Error).message}\n`);
  }
}

/**
 * Decide what becomes of the "working" marker now the run is over.
 *
 * The marker holds the boundary while the run is in flight. Once the model has
 * posted its own answer, that answer is newer and holds the boundary, so the
 * marker is noise and is removed. When nothing was posted, the marker is the
 * only thing that can tell the humans what happened, so it is updated in place —
 * which keeps its creation time, and therefore the boundary, so a failing run is
 * not retried automatically on every later tick.
 */
/**
 * Why a turn ended without a usable answer.
 *
 * `answered-no-reply` has three causes and they are not interchangeable: only
 * "the model posted nothing" may later be overridden by the discovery of a new
 * pull request. Overriding a flagged mid-run message, or an unverified read,
 * would silence a real degradation.
 */
type ReconcileReason = "answered" | "no-answer" | "flagged" | "unverified";

interface Reconciled {
  outcome: Outcome;
  detail: string;
  reason: ReconcileReason;
}

function reconcileMarker(
  item: WorkItem,
  marker: MarkerRef,
  participants: Participants,
  watermark: string | null,
  runError: Error | null,
): Reconciled {
  let analysis: AnswerAnalysis;
  try {
    analysis = analyseAnswer(readAnsweringSurface(item), participants, marker, watermark);
  } catch (err) {
    progress(
      `  warning: could not re-read ${markerSurfaceLabel(item)} to check for an answer: ${(err as Error).message}\n`,
    );
    return reportUnverified(item, marker);
  }

  if (analysis.answeredAt !== null) {
    reportOvertakenMessages(item, analysis);
    try {
      deleteMarker(marker);
    } catch (err) {
      progress(`  warning: could not delete the marker comment: ${(err as Error).message}\n`);
    }
    if (analysis.missed.length > 0) {
      return {
        outcome: "answered-no-reply",
        detail: `answered (${String(analysis.toReport.length)} message(s) arrived mid-run and were flagged)`,
        reason: "flagged",
      };
    }
    return runError === null
      ? { outcome: "answered", detail: "answered", reason: "answered" }
      : { outcome: "answered", detail: `answered, but the run reported: ${runError.message}`, reason: "answered" };
  }

  return reportNoAnswer(item, marker, runError);
}

/** The surface could not be re-read, so nothing about the answer is established. */
function reportUnverified(item: WorkItem, marker: MarkerRef): Reconciled {
  const surface = markerSurfaceLabel(item);
  try {
    updateMarker(
      marker,
      `automata do-work: the agent run finished, but automata could not read ${surface} afterwards ` +
        "to confirm whether an answer was posted. Check this thread and the branch before assuming either. " +
        "Reply here to have another attempt made.",
    );
  } catch (err) {
    progress(`  warning: could not update the marker comment: ${(err as Error).message}\n`);
  }
  return {
    outcome: "answered-no-reply",
    detail: "could not verify whether an answer was posted",
    reason: "unverified",
  };
}

/**
 * The run produced no answer. Deliberately does not claim nothing changed: a run
 * can commit and push and still fail to comment, and a failed run can leave
 * partial work behind.
 */
function reportNoAnswer(item: WorkItem, marker: MarkerRef, runError: Error | null): Reconciled {
  const surface = markerSurfaceLabel(item);
  const sideEffects =
    item.turn === "issue-discuss"
      ? "It may still have created a branch or opened a pull request — check before assuming otherwise."
      : `It may still have changed the branch \`${item.branch}\` — check it before assuming otherwise.`;
  const explanation =
    runError === null
      ? `automata do-work: the agent run finished without posting an answer on ${surface}. ` +
        `${sideEffects} Reply on ${surface} to have another attempt made.`
      : `automata do-work: the agent run failed before posting an answer (${runError.message}). ` +
        `${sideEffects} Reply on ${surface} to have another attempt made.`;
  try {
    updateMarker(marker, explanation);
  } catch (err) {
    progress(
      `  warning: could not update the marker comment on ${surface}: ${(err as Error).message}\n` +
        `  the humans have not been told that this run produced no answer.\n`,
    );
  }
  return runError === null
    ? { outcome: "answered-no-reply", detail: "run finished but posted no answer", reason: "no-answer" }
    : { outcome: "failed", detail: `run failed: ${runError.message}`, reason: "no-answer" };
}

async function invokeExecutor(
  prompt: string,
  execution: ResolvedExecution,
  silent: boolean,
): Promise<void> {
  // Both runners spawn asynchronously, register the child for cancellation, and
  // throw instead of exiting, so a failed run reconciles its marker and the tick
  // continues with the next item.
  if (execution.executor === "codex") {
    await runCodex(prompt, { model: execution.model, effort: execution.effort });
    return;
  }
  await runClaude(prompt, { model: execution.model, effort: execution.effort, printSteps: !silent });
}

/**
 * After a discuss turn the model may have opened a pull request; the link is the
 * state machine, so make sure it exists.
 *
 * Only ever for a branch the turn moved onto. A discussion turn starts on the
 * base branch, and if the model merely replied we are still there — where
 * `getCurrentBranchPr()` would return the base branch's *own* pull request (a
 * release PR into `main`, say) and appending `Closes #<issue>` to it would make
 * an unrelated merge close this issue.
 */
function repairIssueLink(item: WorkItem, baseBranch: string, agentUser: string): boolean {
  const issue = item.issue;
  if (issue === null) return false;
  try {
    const branch = getCurrentBranch();
    if (branch === baseBranch) {
      progress(`  issue #${String(issue.number)} is still in discussion (no branch was created).\n`);
      return false;
    }

    const pr = getCurrentBranchPr();
    if (!pr) {
      progress(`  issue #${String(issue.number)} is still in discussion (no pull request).\n`);
      return false;
    }
    // Claimed here rather than in the plan: a discuss turn has no pull request
    // when the decision is made, so this is the first point at which the one the
    // model just opened is visible. Before the `Closes #N` check on purpose, so a
    // second discuss turn on an already-linked pull request still claims it.
    if (pr.assignees.length === 0) {
      claimPr(pr.number, agentUser);
    }
    // Word boundary: `includes("Closes #42")` also matches `Closes #420`.
    const closesRef = new RegExp(String.raw`\bcloses\s+#` + String(issue.number) + String.raw`\b`, "i");
    if (closesRef.test(pr.body)) {
      progress(`  pull request #${String(pr.number)} already closes issue #${String(issue.number)}.\n`);
      return true;
    }
    addClosesRefToPr(pr.number, issue.number);
    progress(`  linked pull request #${String(pr.number)} to issue #${String(issue.number)}.\n`);
    return true;
  } catch (err) {
    progress(`  warning: could not link a pull request to issue #${String(issue.number)}: ${(err as Error).message}\n`);
    return false;
  }
}

/**
 * Give up on an item after the `working…` marker is posted but before anything
 * is invoked, replacing the marker with an explanation.
 *
 * Both callers refuse *after* the marker on purpose: the marker edit is what
 * advances the answer boundary, so refusing before it would leave the offending
 * message new forever and re-refuse it on every later tick instead of
 * explaining itself once. Neither sets `ranExecutor` — nothing ran, so the item
 * must not spend a slot from the run cap.
 */
function refuseBeforeRun(
  base: Pick<ItemReport, "issue" | "pr" | "title" | "turn">,
  marker: MarkerRef,
  detail: string,
  markerText: string,
): ItemReport {
  progress(`  failed: ${detail}\n`);
  inFlightMarker = null;
  try {
    updateMarker(marker, markerText);
  } catch (err) {
    progress(`  warning: could not update the marker comment: ${(err as Error).message}\n`);
  }
  return { ...base, outcome: "failed", detail };
}

async function processItem(
  planned: WorkItem,
  settings: Settings,
  silent: boolean,
): Promise<ItemReport> {
  progress(`\n${itemLabel(planned)} ${planned.turn}: ${planned.reason}\n`);

  // The tick's plan was built before any model ran, and an earlier item can take
  // a long time. Re-read this issue now, so a message that arrived in the
  // meantime is answered rather than being buried behind the marker we are about
  // to post — which would make it older than the boundary and never new again.
  const refreshed = refreshItem(planned, settings);
  if (refreshed.kind === "skip") {
    progress(`  skipped: ${refreshed.detail}\n`);
    return {
      issue: planned.issue?.number ?? null,
      pr: planned.pr?.number ?? null,
      title: itemTitle(planned),
      turn: planned.turn,
      outcome: "skipped",
      detail: `no longer actionable: ${refreshed.detail}`,
    };
  }
  const item = refreshed.item;
  if (item.turn !== planned.turn) {
    progress(`  turn changed to ${item.turn} since the plan was built; using the current state.\n`);
  }

  // Reported from the refreshed item: the summary must say which turn actually
  // ran, not the one the stale plan predicted.
  const base: Pick<ItemReport, "issue" | "pr" | "title" | "turn"> = {
    issue: item.issue?.number ?? null,
    pr: item.pr?.number ?? null,
    title: itemTitle(item),
    turn: item.turn,
  };

  const prepared =
    item.turn === "issue-discuss" ? prepareBaseBranch(item.branch) : preparePrBranch(item.branch);
  if (!prepared.ok) {
    progress(`  skipped: ${prepared.reason} — ${prepared.detail}\n`);
    return { ...base, outcome: "skipped", detail: `${prepared.reason}: ${prepared.detail}` };
  }

  claimIssue(item, settings);
  if (item.turn === "pr-work" && item.pr !== null && item.prNeedsAssignment) {
    claimPr(item.pr.number, settings.participants.agentUser);
  }

  let marker: MarkerRef;
  const markerTarget = markerSurfaceTarget(item);
  try {
    marker = postMarker(markerTarget.surface, markerTarget.number, "automata do-work: working…");
  } catch (err) {
    // Without the marker there is no boundary, so a run now would be answered
    // again on every later tick. Skipping leaves the message for the next tick.
    progress(`  skipped: could not post the working marker — ${(err as Error).message}\n`);
    return { ...base, outcome: "skipped", detail: `marker failed: ${(err as Error).message}` };
  }
  inFlightMarker = { marker, item };

  // Ordered *after* the marker deliberately: the note is permanent, so posting
  // it and then failing to post the marker would advance the issue boundary past
  // a message that never got answered.
  const note = notePickupOnIssue(item, marker);
  if (note === false) {
    inFlightMarker = null;
    return { ...base, outcome: "skipped", detail: "issue pickup note failed" };
  }
  let buriedByNote = 0;
  if (note !== null) {
    progress(`  noted on issue #${String(item.issue?.number ?? 0)} that the work is on pull request #${String(item.pr?.number ?? 0)}.\n`);
    buriedByNote = reportIssueMessagesBuriedByNote(item, note, settings.participants);
  }

  // Measured from the messages the prompt actually carries, not from the marker:
  // the marker is posted several API calls later (link-map pagination, branch
  // fetch and checkout, assignment), so measuring against it would declare a
  // message seen when the prompt never contained it.
  // Every message the prompt carried, including the authorized review-thread
  // comments. Those live in `actionableThreads`, not in `prAnalysis` — only the
  // agent's thread comments are folded in there — so leaving them out made the
  // trigger of a thread-driven turn look like a message that arrived mid-run,
  // and every such turn posted a spurious "please post again" comment.
  const watermark = promptWatermark([
    item.issueAnalysis.messages,
    item.prAnalysis?.messages ?? [],
    item.actionableThreads.flatMap((thread) => thread.comments),
  ]);

  const prompt = composePrompt({
    item,
    repo: getRepoSlug(),
    agentUser: settings.participants.agentUser,
    baseBranch: settings.baseBranch,
    frame: settings.prompts[item.turn],
  });

  const oversized = describeOversizedPrompt(prompt);
  if (oversized !== null) {
    return refuseBeforeRun(
      base,
      marker,
      oversized,
      `automata do-work: could not start a run because ${oversized} ` +
        "Summarise the discussion in a new issue, or shorten the thread, and try again.",
    );
  }

  // Resolved here, beside the oversized-prompt refusal, because both are
  // pre-flight refusals that need the marker to already exist.
  const resolved = resolveItemExecution(item, settings);
  if (!resolved.ok) {
    const detail = describeInvalidTool(resolved.invalidTool);
    return refuseBeforeRun(
      base,
      marker,
      detail,
      `automata do-work: ${detail}. No run was started. ` +
        "Reply here with a corrected directive, or none at all, to have another attempt made.",
    );
  }
  const execution = toExecution(resolved);

  let runError: Error | null = null;
  try {
    await invokeExecutor(prompt, execution, silent);
  } catch (err) {
    runError = err as Error;
  }
  const ranExecutor = true;

  inFlightMarker = null;
  const reconciled = reconcileMarker(item, marker, settings.participants, watermark, runError);
  progress(`  ${reconciled.detail}\n`);

  const outcome = adjustOutcome(reconciled, item, settings, buriedByNote);

  return { ...base, outcome: outcome.outcome, detail: outcome.detail, ranExecutor, execution };
}

// Linux caps a single argv entry at 128 KiB (MAX_ARG_STRLEN), and the prompt is
// passed as one. A long-lived issue with many authorized comments can reach
// that, and the raw failure is an opaque E2BIG from spawn. Fail legibly instead;
// piping the prompt through stdin is the real fix and is tracked separately.
function describeOversizedPrompt(prompt: string): string | null {
  const MAX_PROMPT_BYTES = 96 * 1024;
  const promptBytes = Buffer.byteLength(prompt, "utf8");
  if (promptBytes <= MAX_PROMPT_BYTES) return null;
  return (
    `the composed prompt is ${String(Math.round(promptBytes / 1024))} KiB, over the ${String(MAX_PROMPT_BYTES / 1024)} KiB ` +
    "limit for a single command-line argument. The conversation is too long to hand to the executor this way."
  );
}

function adjustOutcome(
  reconciled: Reconciled,
  item: WorkItem,
  settings: Settings,
  buriedByNote: number,
): Reconciled {
  let outcome = reconciled;
  if (buriedByNote > 0 && outcome.outcome === "answered") {
    outcome = {
      outcome: "answered-no-reply",
      detail: `${outcome.detail} (${String(buriedByNote)} issue message(s) were buried by the pickup note and flagged)`,
      reason: "flagged",
    };
  }

  if (item.turn !== "issue-discuss") return outcome;

  const linked = repairIssueLink(item, settings.baseBranch, settings.participants.agentUser);
  // A discuss turn that implemented and opened a pull request has plainly not
  // stalled, even if the model never commented on the issue. Reporting it as
  // "produced no answer" would raise a false alarm; the pull request is the
  // answer, and its `Closes #N` is the durable record.
  // Only a genuine silence is overridden. A flagged mid-run message or an
  // unverified read are real degradations and must keep their exit 2.
  if (linked && outcome.reason === "no-answer") {
    progress("  a pull request was opened, so the turn is counted as answered.\n");
    return {
      outcome: "answered",
      detail: "opened a pull request (no issue comment)",
      reason: "answered",
    };
  }

  return outcome;
}

function summarize(reports: ItemReport[]): void {
  out("\nTick summary:\n");
  if (reports.length === 0) {
    out("  nothing to do\n");
    return;
  }
  for (const report of reports) {
    // Named unconditionally rather than only when a directive was used: an
    // absent field would be ambiguous between "no directive" and "an older
    // automata" when read back out of a cron log.
    const ran = report.execution === undefined ? "" : ` · ${describeExecution(report.execution)}`;
    out(`  ${reportLabel(report)} ${report.turn ?? "-"} ${report.outcome} — ${report.detail}${ran}\n`);
  }
}

/** An item report as data, with the effective executor and model flattened. */
function toItemJson(report: ItemReport): Record<string, unknown> {
  return {
    issue: report.issue,
    pr: report.pr,
    title: report.title,
    turn: report.turn,
    outcome: report.outcome,
    detail: report.detail,
    ranExecutor: report.ranExecutor ?? false,
    executor: report.execution?.executor ?? null,
    model: report.execution?.model ?? null,
    effort: report.execution?.effort ?? null,
    executorSource: report.execution?.executorSource ?? null,
    modelSource: report.execution?.modelSource ?? null,
    effortSource: report.execution?.effortSource ?? null,
  };
}

export const doWorkCommand = new Command("do-work")
  .description(
    "Run one tick of the autonomous loop: answer the issues whose newest authorized message the agent has not answered, " +
      "then the open pull requests that close no issue of this repository and have one",
  )
  .option("--with <executor>", "Executor to use: claude or codex (default: from config, else claude)")
  .option("--model <string>", "Model identifier to pass to the executor, overriding the configured default for it")
  .option(
    "--effort <level>",
    "Reasoning effort to pass to the executor, overriding the configured default for it",
  )
  .option("--issue <number>", "Restrict the tick to a single issue")
  .option(
    "--pr <number>",
    "Restrict the orphan-pull-request pass to a single pull request (one that closes no issue of this repository)",
  )
  .option("--limit <n>", "Maximum number of issues to fetch", "10")
  .option("--max-runs <n>", "Maximum number of model runs this tick")
  .option(
    "--dry-run",
    "Print the work plan, plus a summary and the exact command that would be launched for each item, and exit without changing anything",
  )
  .option("--json", "Emit the work plan and outcomes as JSON on stdout")
  .option("--silent", "Suppress step-by-step Claude output; show only the final summary")
  .action(async (options: DoWorkOptions) => {
    // Before `resolveSettings`, which exits through `fail()` on any bad
    // configuration: arming this first is what lets that path be logged.
    const startedAt = Date.now();
    if (options.dryRun !== true) loggableInvocation = { startedAt };

    const settings = resolveSettings(options);

    // A dry run changes nothing, so it neither needs the lock nor should be
    // blocked by one — being unable to inspect the plan while a tick is running
    // would defeat the primary diagnostic. It also avoids creating the lock file
    // in a repository that has not ignored it.
    if (options.dryRun === true) {
      const { exitCode } = await runTick(settings, options);
      if (exitCode !== 0) process.exit(exitCode);
      return;
    }

    // From here the ordinary paths below do the logging; `fail()` must not.
    loggableInvocation = null;

    const lock = acquireRunLock("do-work", settings.lockStaleMinutes);
    if (!lock.ok) {
      const exitCode = reportLockHeld(lock, settings, options);
      // A loop wedged behind a stale lock does nothing on every tick, and
      // without a line that is indistinguishable from cron having stopped
      // firing — which is the failure the execution log exists to expose.
      logTick([], exitCode, startedAt, "lock-held");
      if (exitCode !== 0) process.exit(exitCode);
      return;
    }

    const handle: LockHandle = lock.handle;
    // Stop the executor before releasing the lock. Exiting the parent while a
    // streaming child keeps running would leave a model editing and pushing
    // while the next cron tick picks up the freed lock.
    let shuttingDown = false;
    const onSignal = (): void => {
      if (shuttingDown) return;
      shuttingDown = true;
      progress("\nInterrupted: stopping the executor before releasing the run lock…\n");
      explainInterruptedMarker();
      void terminateTrackedChildren().then((allExited) => {
        if (allExited) {
          handle.release();
        } else {
          // Releasing now would hand the lock to the next tick while a model may
          // still be running. Leaving it held is the safer failure: it is
          // reclaimable through the staleness window once this process is gone.
          progress(
            "Warning: could not confirm the executor exited; leaving the run lock in place. " +
              "Check for a stray executor process before the next tick.\n",
          );
        }
        process.exit(130);
      });
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);

    let exitCode: number;
    let reports: ItemReport[] = [];
    try {
      const result = await runTick(settings, options);
      exitCode = result.exitCode;
      reports = result.reports;
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      exitCode = 1;
    } finally {
      handle.release();
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
    }

    // After the lock is released: a log write must never extend the window in
    // which the next cron tick is turned away.
    logTick(reports, exitCode, startedAt);

    if (exitCode !== 0) process.exit(exitCode);
  });

/** An item report as the operation log wants it, mirroring `toItemJson`. */
function toTickLogItem(report: ItemReport): TickLogItem {
  return {
    subject: reportLabel(report),
    turn: report.turn,
    outcome: report.outcome,
    detail: report.detail,
    ranExecutor: report.ranExecutor ?? false,
    executor: report.execution?.executor,
    model: report.execution?.model,
    effort: report.execution?.effort,
  };
}

/**
 * Append this invocation to the operation log. Best-effort throughout:
 * `recordTick` swallows every filesystem failure, and the slug lookup shells
 * out to `git remote get-url origin`, so a broken remote logs `repo=-` rather
 * than taking the tick down after it has already succeeded.
 */
function logTick(reports: ItemReport[], exitCode: number, startedAt: number, note?: string): void {
  let repo: string | null;
  try {
    const slug = getRepoSlug();
    repo = `${slug.owner}/${slug.repo}`;
  } catch {
    repo = null;
  }
  recordTick({
    command: "do-work",
    repo,
    timestamp: new Date(),
    durationMs: Date.now() - startedAt,
    exitCode,
    note,
    items: reports.map(toTickLogItem),
  });
}

// Not a failure: cron firing while a tick is still running is normal. Returns
// the exit code the caller should use.
function reportLockHeld(
  lock: Extract<ReturnType<typeof acquireRunLock>, { ok: false }>,
  settings: Settings,
  options: DoWorkOptions,
): number {
  const held = lock.heldBy;
  const sentence =
    `Another automata instance is already running here (pid ${String(held.pid)} on ` +
    `${held.host}, started ${held.startedAt}, command ${held.command}). Doing nothing.\n`;
  // A lock that looks alive but has outlived the staleness window may be a
  // pid-reuse orphan, in which case every future tick would also do nothing.
  // Exiting 0 there hides a dead loop behind a healthy status.
  const suspectSentence = lock.suspect
    ? `Warning: that lock has been held longer than ${String(settings.lockStaleMinutes)} minutes. ` +
      "If no tick is really running, its process id was probably reused; remove " +
      `${RUN_LOCK_RELATIVE_PATH} once you have confirmed that.\n`
    : "";
  const exitCode = lock.suspect ? 2 : 0;

  if (options.json === true) {
    // stdout must stay parseable for a caller that asked for JSON.
    progress(sentence + suspectSentence);
    out(
      JSON.stringify({ lockHeld: true, suspect: lock.suspect, heldBy: held, plan: [], items: [], exitCode }, null, 2) +
        "\n",
    );
  } else {
    out(sentence);
    if (suspectSentence) progress(suspectSentence);
  }

  return exitCode;
}

// Leave an explanation rather than a bare "working…" that silently holds the
// boundary for good.
function explainInterruptedMarker(): void {
  const pending = inFlightMarker;
  if (pending === null) return;
  try {
    updateMarker(
      pending.marker,
      "automata do-work: this run was interrupted before it finished, so no answer was produced. " +
        `The branch \`${pending.item.branch}\` may have been changed. Reply here to have another attempt made.`,
    );
  } catch (err) {
    progress(`Warning: could not update the in-flight marker: ${(err as Error).message}\n`);
  }
}

interface TickResult {
  exitCode: number;
  /** Empty for a dry run; the action needs these to write the operation log. */
  reports: ItemReport[];
}

async function runTick(settings: Settings, options: DoWorkOptions): Promise<TickResult> {
  // Before anything is read from GitHub: put the repository into a known state.
  // Uncommitted work is committed and pushed rather than left to make every item
  // skip on `dirty-tree`, the base branch is fast-forwarded whether or not there
  // turns out to be work, and dead local branches go. It runs inside the run
  // lock (the caller took it) because every step writes to this one checkout.
  const hygiene = runRepoHygiene({
    baseBranch: settings.baseBranch,
    protectedBranches: settings.protectedBranches,
    dryRun: options.dryRun === true,
    agentUser: settings.participants.agentUser,
    log: progress,
  });

  const issues = discoverIssues(settings);
  const linkMap = getOpenPrLinkMap();
  const policy = {
    baseBranch: settings.baseBranch,
    defaultBranch: linkMap.defaultBranch,
    protectedBranches: settings.protectedBranches,
  };

  // Issues first, then the orphan pull requests, and the ordering is load
  // bearing: the two passes share one run cap, so a pile of dependency-bump
  // pull requests must not be able to starve the issues.
  const decisions = skipDuplicateHeadBranches([
    ...issues.map((issue) => decideWork(buildIssueState(issue, linkMap), settings.participants, policy)),
    ...discoverOrphanPrs(settings, linkMap).map((candidate) =>
      decideOrphanPrWork({ prSurface: getPrSurface(candidate.pr.number) }, settings.participants, policy),
    ),
  ]);
  const items = decisions.flatMap((decision) => (decision.kind === "work" ? [decision.item] : []));

  const planText = `Work plan (${String(items.length)} of ${String(decisions.length)} candidates need an answer):\n${describePlan(decisions)}`;
  if (options.json) {
    progress(planText);
  } else {
    out(planText);
  }

  if (options.dryRun) {
    reportDryRun(items, decisions, settings, options, hygiene);
    return { exitCode: 0, reports: [] };
  }

  // The cap counts *model runs*, not planned items: an item that turns out not
  // to be actionable, or that is skipped for a dirty tree or a failed marker,
  // must not consume a slot — otherwise a tick configured for one run can
  // perform none while actionable work waits.
  const reports: ItemReport[] = [];
  const deferred: WorkItem[] = [];
  let runsUsed = 0;

  for (const item of items) {
    if (settings.maxRuns > 0 && runsUsed >= settings.maxRuns) {
      deferred.push(item);
      continue;
    }
    // An error from one item — a failed refresh read, say — is that item's
    // outcome, not the tick's. Letting it escape would exit 1, which is
    // documented as "nothing was attempted", while discarding the summary for
    // items that had already run.
    let report: ItemReport;
    try {
      report = await processItem(item, settings, options.silent === true);
    } catch (err) {
      progress(`  failed: ${(err as Error).message}\n`);
      report = {
        issue: item.issue?.number ?? null,
        pr: item.pr?.number ?? null,
        title: itemTitle(item),
        turn: item.turn,
        outcome: "failed",
        detail: (err as Error).message,
      };
    }
    // The cap counts model runs. An item that failed before reaching the
    // executor — a refresh read error, say — did not spend one.
    if (report.ranExecutor === true) runsUsed++;
    reports.push(report);
  }

  for (const item of deferred) {
    progress(`\n${itemLabel(item)} deferred: --max-runs / maxRunsPerTick reached.\n`);
    reports.push({
      issue: item.issue?.number ?? null,
      pr: item.pr?.number ?? null,
      title: itemTitle(item),
      turn: item.turn,
      outcome: "deferred",
      detail: `run cap of ${String(settings.maxRuns)} reached`,
    });
  }

  // "answered-no-reply" counts as degraded: the run produced nothing, a human has
  // to reply before anything more happens, and an unattended loop must surface
  // that rather than report a healthy tick.
  // A pre-flight step that failed degrades the tick too: the work it was meant
  // to protect is still uncommitted, or the base branch is not where the tick
  // assumed. Exit 1 is not available for it — that is documented as "nothing was
  // attempted", which by this point is false.
  const degraded = hygiene.degraded || reports.some((report) => report.outcome !== "answered");
  const exitCode = degraded ? 2 : 0;

  if (options.json) {
    out(
      JSON.stringify(
        {
          dryRun: false,
          preflight: toHygieneJson(hygiene),
          plan: decisions.map(toPlanJson),
          items: reports.map(toItemJson),
          exitCode,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    summarizeHygiene(hygiene);
    summarize(reports);
  }

  return { exitCode, reports };
}

/**
 * One item of a dry run: either the command that would be launched, or the
 * refusal that would replace it.
 */
type DryRunEntry =
  | { kind: "run"; item: WorkItem; execution: ResolvedExecution; run: PlannedRun }
  | { kind: "refused"; item: WorkItem; refusal: string };

function toRunJson(entry: DryRunEntry): Record<string, unknown> {
  if (entry.kind === "refused") {
    return {
      issue: entry.item.issue?.number ?? null,
      pr: entry.item.pr?.number ?? null,
      turn: entry.item.turn,
      executor: null,
      model: null,
      effort: null,
      executorSource: null,
      modelSource: null,
      effortSource: null,
      refusal: entry.refusal,
      bin: null,
      args: null,
      command: null,
      prompt: null,
    };
  }
  return {
    issue: entry.item.issue?.number ?? null,
    pr: entry.item.pr?.number ?? null,
    turn: entry.item.turn,
    executor: entry.execution.executor,
    model: entry.execution.model ?? null,
    effort: entry.execution.effort ?? null,
    executorSource: entry.execution.executorSource,
    modelSource: entry.execution.modelSource,
    effortSource: entry.execution.effortSource,
    refusal: null,
    bin: entry.run.bin,
    args: entry.run.args,
    command: entry.run.command,
    prompt: entry.run.prompt,
  };
}

/** Print (or emit) what a real tick would do, without doing any of it. */
function reportDryRun(
  items: WorkItem[],
  decisions: Decision[],
  settings: Settings,
  options: DoWorkOptions,
  hygiene: HygieneReport,
): void {
  const describable = settings.maxRuns > 0 ? items.slice(0, settings.maxRuns) : items;
  // An unrecognised `tool:` is described as the refusal a real tick would
  // perform, rather than as a command: a dry run must show the typo, not a
  // plausible command line that would never be launched.
  const planned: DryRunEntry[] = describable.map((item) => {
    const resolved = resolveItemExecution(item, settings);
    if (!resolved.ok) {
      return { kind: "refused", item, refusal: describeInvalidTool(resolved.invalidTool) };
    }
    const execution = toExecution(resolved);
    return { kind: "run", item, execution, run: planRun(item, settings, execution) };
  });

  if (options.json) {
    out(
      JSON.stringify(
        {
          dryRun: true,
          preflight: toHygieneJson(hygiene),
          plan: decisions.map(toPlanJson),
          runs: planned.map(toRunJson),
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  summarizeHygiene(hygiene);
  for (const entry of planned) {
    out(
      "\n" +
        (entry.kind === "refused"
          ? describeRefusedRun(entry.item, entry.refusal)
          : describePlannedRun(entry.item, settings, entry.run, entry.execution)),
    );
  }
  const deferred = items.length - describable.length;
  if (deferred > 0) {
    out(`\n(${String(deferred)} further item(s) deferred by the run cap.)\n`);
  }
  out(
    "\nDry run: nothing was rescued, pruned, pulled, assigned, posted, checked out or executed.\n",
  );
}

/** One stdout line per pre-flight step, so the summary is self-contained. */
function summarizeHygiene(hygiene: HygieneReport): void {
  out("\nPre-flight:\n");
  out(`  rescue ${describeRescue(hygiene.rescue)}\n`);
  out(
    hygiene.base.ok
      ? "  base   ready\n"
      : `  base   ${hygiene.base.step} failed — ${hygiene.base.detail}\n`,
  );
  if (hygiene.prunes.length === 0) {
    out("  prune  no candidates\n");
  } else {
    for (const outcome of hygiene.prunes) {
      out(`  prune  ${describePrune(outcome)}\n`);
    }
  }
}

function describeRescue(rescue: HygieneReport["rescue"]): string {
  switch (rescue.kind) {
    case "clean":
      return "nothing to rescue";
    case "rescued":
      return rescue.prCreated
        ? `committed and pushed ${rescue.branch}, opened draft PR #${String(rescue.pr)}`
        : `committed and pushed ${rescue.branch}, PR #${String(rescue.pr)} already open`;
    case "would-rescue":
      return `would rescue onto ${rescue.branch}`;
    case "failed":
      return `${rescue.step} failed — ${rescue.detail}; the tree is still dirty and nothing was discarded`;
  }
}

function describePrune(outcome: PruneOutcome): string {
  switch (outcome.kind) {
    case "deleted":
      return `deleted ${outcome.branch}`;
    case "would-delete":
      return `would delete ${outcome.branch}`;
    case "kept":
      return `kept ${outcome.branch} (${outcome.reason}: ${outcome.detail})`;
    case "rescued":
      return outcome.pr === null
        ? `rescued ${outcome.branch} (pushed; no PR opened)`
        : `rescued ${outcome.branch} (pushed, draft PR #${String(outcome.pr)})`;
    case "would-rescue":
      return `would rescue ${outcome.branch} (${String(outcome.unmergedCommits)} unmerged commit(s))`;
  }
}

function toHygieneJson(hygiene: HygieneReport): Record<string, unknown> {
  return {
    rescue: hygiene.rescue,
    base: hygiene.base,
    prunes: hygiene.prunes,
    degraded: hygiene.degraded,
  };
}

function toPlanJson(decision: Decision): Record<string, unknown> {
  if (decision.kind === "skip") {
    return {
      issue: decision.issue?.number ?? null,
      pr: decision.pr?.number ?? null,
      title: decision.issue?.title ?? decision.pr?.title ?? "",
      turn: null,
      skipReason: decision.reason,
      reason: decision.detail,
    };
  }
  const item = decision.item;
  return {
    issue: item.issue?.number ?? null,
    pr: item.pr?.number ?? null,
    title: itemTitle(item),
    turn: item.turn,
    branch: item.branch,
    needsAssignment: item.needsAssignment,
    prNeedsAssignment: item.prNeedsAssignment,
    reason: item.reason,
  };
}
