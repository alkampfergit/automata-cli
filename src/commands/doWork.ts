import { Command } from "commander";
import {
  readConfig,
  DEFAULT_DO_WORK,
  DEFAULT_DO_WORK_ISSUE_DISCUSS_PROMPT,
  DEFAULT_DO_WORK_PR_WORK_PROMPT,
  type AutomataConfig,
  type Executor,
  type TurnKind,
} from "../config/configStore.js";
import { addClosesRefToPr, getCurrentBranchPr, type GitHubIssue } from "../config/githubService.js";
import {
  assignIssueToAgent,
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
} from "../github/ghWorkService.js";
import type { RawMessage, Participants } from "../github/conversation.js";
import {
  decideWork,
  selectLinkedPr,
  type Decision,
  type IssueState,
  type WorkItem,
} from "../github/workDetection.js";
import { composePrompt } from "../github/workPrompt.js";
import {
  analyseAnswer,
  messagesBetween,
  promptWatermark,
  type AnswerAnalysis,
} from "../github/markerReconciliation.js";
import { prepareBaseBranch, preparePrBranch } from "../git/workspaceService.js";
import { getCurrentBranch } from "../git/gitService.js";
import { acquireRunLock, RUN_LOCK_RELATIVE_PATH, type LockHandle } from "../run/runLock.js";
import { runClaude, buildClaudeArgs, resolveCommand } from "../claude/claudeService.js";
import { runCodex, buildCodexArgs } from "../codex/codexService.js";
import { terminateTrackedChildren } from "../cli/childRegistry.js";
import { shellQuote } from "../cli/spawnUtils.js";

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
  issue?: string;
  limit: string;
  maxRuns?: string;
  dryRun?: boolean;
  json?: boolean;
  silent?: boolean;
}

interface Settings {
  baseBranch: string;
  protectedBranches: string[];
  executor: Executor;
  model: string | undefined;
  maxRuns: number;
  lockStaleMinutes: number;
  limit: number;
  participants: Participants;
  prompts: Record<TurnKind, string>;
  technique: NonNullable<AutomataConfig["issueDiscoveryTechnique"]>;
  discoveryValue: string;
  onlyIssue: number | undefined;
}

interface ItemReport {
  issue: number;
  title: string;
  turn: TurnKind | null;
  outcome: Outcome;
  detail: string;
  /** True only when the executor was actually invoked — what the run cap counts. */
  ranExecutor?: boolean;
}

/** stdout carries the plan and the summary; stderr carries progress and warnings. */
function out(message: string): void {
  process.stdout.write(message);
}

function progress(message: string): void {
  process.stderr.write(message);
}

function fail(message: string): never {
  process.stderr.write(`Error: ${message}\n`);
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

  let executor: Executor = doWork.executor ?? DEFAULT_DO_WORK.executor;
  if (options.with !== undefined) {
    const requested = options.with.toLowerCase();
    if (requested !== "claude" && requested !== "codex") {
      fail(`--with must be 'claude' or 'codex', got '${options.with}'.`);
    }
    executor = requested;
  }

  // A dry run posts nothing, so the identity that would post is irrelevant; the
  // guard must not block the primary diagnostic.
  if (options.dryRun !== true) {
    checkAuthenticatedIdentity(agentUser, allowedUsers);
  }

  return {
    baseBranch: doWork.baseBranch ?? DEFAULT_DO_WORK.baseBranch,
    protectedBranches: doWork.protectedBranches ?? DEFAULT_DO_WORK.protectedBranches,
    executor,
    // --model wins; otherwise take the default for the executor in use.
    model: options.model ?? doWork.models?.[executor],
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
    },
    technique: config.issueDiscoveryTechnique,
    discoveryValue: config.issueDiscoveryValue,
    onlyIssue: options.issue === undefined ? undefined : parsePositiveInt(options.issue, "--issue"),
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
 * What would be executed for a work item, built with the same argv builders the
 * real invocation uses so `--dry-run` cannot drift from what actually happens.
 */
function planRun(item: WorkItem, settings: Settings): PlannedRun {
  const prompt = composePrompt({
    item,
    repo: getRepoSlug(),
    agentUser: settings.participants.agentUser,
    baseBranch: settings.baseBranch,
    frame: settings.prompts[item.turn],
  });

  // The resolved path, not the bare name: this is literally what gets spawned.
  const bin = resolveCommand(settings.executor === "codex" ? "codex" : "claude");
  // `verbose: true` unconditionally, because `runClaude` always streams so the
  // child stays cancellable; `--silent` suppresses printing, not the flags.
  const args =
    settings.executor === "codex"
      ? buildCodexArgs(prompt, { yolo: true, model: settings.model })
      : buildClaudeArgs(prompt, { yolo: true, verbose: true, model: settings.model });

  return { prompt, bin, args, command: [bin, ...args].map(shellQuote).join(" ") };
}

/** The per-item summary header printed above the command on a dry run. */
function describePlannedRun(item: WorkItem, settings: Settings, run: PlannedRun): string {
  const rule = "─".repeat(72);
  const branchAction = item.turn === "pr-work" ? " and fast-forward" : " and pull";
  const assignment = item.needsAssignment
    ? `would assign to ${settings.participants.agentUser}`
    : "already assigned";
  const markerTarget =
    item.turn === "pr-work" && item.pr
      ? `pull request #${String(item.pr.number)}`
      : `issue #${String(item.issue.number)}`;
  const modelNote = settings.model === undefined ? " (no model override)" : ` · model ${settings.model}`;
  const lines = [
    rule,
    `Issue #${String(item.issue.number)} — ${item.issue.title}`,
    rule,
    `  Turn         ${item.turn}`,
    `  Why          ${item.reason}`,
    `  Branch       ${item.branch} (would check out${branchAction})`,
    `  Assign       ${assignment}`,
    `  Marker       would post on ${markerTarget}`,
    `  Executor     ${settings.executor}${modelNote}`,
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

  const protectedBranches = section["protectedBranches"];
  if (protectedBranches !== undefined && protectedBranches !== null) {
    if (!Array.isArray(protectedBranches) || protectedBranches.some((b) => typeof b !== "string" || b.trim().length === 0)) {
      fail("doWork.protectedBranches must be an array of non-empty strings.");
    }
  }

  for (const container of ["models", "prompts"] as const) {
    const value = section[container];
    if (value === undefined || value === null) continue;
    if (!isPlainObject(value)) {
      fail(`doWork.${container} must be an object, got ${JSON.stringify(value)}.`);
    }
    const keys = container === "models" ? ["claude", "codex"] : ["issueDiscuss", "prWork"];
    for (const key of keys) {
      validateOptionalString(value, key, `doWork.${container}.${key}`);
    }
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) {
        fail(`doWork.${container}.${key} is not a recognised setting; expected one of: ${keys.join(", ")}.`);
      }
    }
  }
}

function discoverIssues(settings: Settings): GitHubIssue[] {
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

/** Does this specific issue satisfy the configured discovery filter? */
function issueMatchesFilter(surface: IssueSurface, settings: Settings): boolean {
  const value = settings.discoveryValue.toLowerCase();
  switch (settings.technique) {
    case "label":
      return surface.labels.some((label) => label.toLowerCase() === value);
    case "assignee":
      return surface.assignees.some((assignee) => assignee.toLowerCase() === value);
    case "title-contains":
      return surface.issue.title.toLowerCase().includes(value);
  }
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
      return `  #${String(decision.issue.number)} nothing to do — ${decision.detail}`;
    }
    const item = decision.item;
    const claim = item.needsAssignment ? ", will assign to the agent" : "";
    return `  #${String(item.issue.number)} ${item.turn} on ${item.branch} — ${item.reason}${claim}`;
  });
  return lines.length === 0 ? "  (no issues matched the discovery filter)\n" : lines.join("\n") + "\n";
}

/**
 * Add the agent as an assignee, so the claim is visible in the issue list.
 *
 * Advisory: a repository where the agent lacks write access must still be able
 * to run the loop, so a failure warns rather than stopping the turn.
 */
function claimIssue(item: WorkItem, settings: Settings): void {
  if (!item.needsAssignment) return;
  try {
    assignIssueToAgent(item.issue.number, settings.participants.agentUser);
    progress(`  assigned issue #${String(item.issue.number)} to ${settings.participants.agentUser}.\n`);
  } catch (err) {
    progress(`  warning: could not assign issue #${String(item.issue.number)}: ${(err as Error).message}\n`);
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
  if (item.turn !== "pr-work" || item.pr === null || !item.issueAnalysis.hasNewMessage) return null;
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
  return decideWork(buildIssueState(item.issue, linkMap), settings.participants, {
    baseBranch: settings.baseBranch,
    defaultBranch: linkMap.defaultBranch,
    protectedBranches: settings.protectedBranches,
  });
}

/** Re-read the surface the turn answered, flattened for the answer analysis. */
function readAnsweringSurface(item: WorkItem): RawMessage[] {
  if (item.turn === "issue-discuss" || item.pr === null) {
    return getIssueSurface(item.issue.number).messages;
  }
  const surface = getPrSurface(item.pr.number);
  return [...surface.messages, ...surface.threads.flatMap((thread) => thread.comments)];
}

/** Which surface the turn answers, for marker text that points somewhere real. */
function markerSurfaceLabel(item: WorkItem): string {
  return item.turn === "pr-work" && item.pr
    ? `pull request #${String(item.pr.number)}`
    : `issue #${String(item.issue.number)}`;
}

function markerSurfaceTarget(item: WorkItem): { surface: "issue" | "pr"; number: number } {
  return item.turn === "pr-work" && item.pr
    ? { surface: "pr", number: item.pr.number }
    : { surface: "issue", number: item.issue.number };
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
      `  warning: could not re-read issue #${String(item.issue.number)} to check for an answer: ${(err as Error).message}\n`,
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
      `  warning: could not update the marker comment on issue #${String(item.issue.number)}: ${(err as Error).message}\n` +
        `  the humans have not been told that this run produced no answer.\n`,
    );
  }
  return runError === null
    ? { outcome: "answered-no-reply", detail: "run finished but posted no answer", reason: "no-answer" }
    : { outcome: "failed", detail: `run failed: ${runError.message}`, reason: "no-answer" };
}

async function invokeExecutor(prompt: string, settings: Settings, silent: boolean): Promise<void> {
  // Both runners spawn asynchronously, register the child for cancellation, and
  // throw instead of exiting, so a failed run reconciles its marker and the tick
  // continues with the next item.
  if (settings.executor === "codex") {
    await runCodex(prompt, { model: settings.model });
    return;
  }
  await runClaude(prompt, { model: settings.model, printSteps: !silent });
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
function repairIssueLink(item: WorkItem, baseBranch: string): boolean {
  try {
    const branch = getCurrentBranch();
    if (branch === baseBranch) {
      progress(`  issue #${String(item.issue.number)} is still in discussion (no branch was created).\n`);
      return false;
    }

    const pr = getCurrentBranchPr();
    if (!pr) {
      progress(`  issue #${String(item.issue.number)} is still in discussion (no pull request).\n`);
      return false;
    }
    // Word boundary: `includes("Closes #42")` also matches `Closes #420`.
    const closesRef = new RegExp(String.raw`\bcloses\s+#` + String(item.issue.number) + String.raw`\b`, "i");
    if (closesRef.test(pr.body)) {
      progress(`  pull request #${String(pr.number)} already closes issue #${String(item.issue.number)}.\n`);
      return true;
    }
    addClosesRefToPr(pr.number, item.issue.number);
    progress(`  linked pull request #${String(pr.number)} to issue #${String(item.issue.number)}.\n`);
    return true;
  } catch (err) {
    progress(`  warning: could not link a pull request to issue #${String(item.issue.number)}: ${(err as Error).message}\n`);
    return false;
  }
}

async function processItem(
  planned: WorkItem,
  settings: Settings,
  silent: boolean,
): Promise<ItemReport> {
  progress(`\n#${String(planned.issue.number)} ${planned.turn}: ${planned.reason}\n`);

  // The tick's plan was built before any model ran, and an earlier item can take
  // a long time. Re-read this issue now, so a message that arrived in the
  // meantime is answered rather than being buried behind the marker we are about
  // to post — which would make it older than the boundary and never new again.
  const refreshed = refreshItem(planned, settings);
  if (refreshed.kind === "skip") {
    progress(`  skipped: ${refreshed.detail}\n`);
    return {
      issue: planned.issue.number,
      title: planned.issue.title,
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
  const base: Pick<ItemReport, "issue" | "title" | "turn"> = {
    issue: item.issue.number,
    title: item.issue.title,
    turn: item.turn,
  };

  const prepared =
    item.turn === "issue-discuss" ? prepareBaseBranch(item.branch) : preparePrBranch(item.branch);
  if (!prepared.ok) {
    progress(`  skipped: ${prepared.reason} — ${prepared.detail}\n`);
    return { ...base, outcome: "skipped", detail: `${prepared.reason}: ${prepared.detail}` };
  }

  claimIssue(item, settings);

  let marker: MarkerRef;
  const markerSurface = item.turn === "pr-work" && item.pr ? item.pr.number : item.issue.number;
  try {
    marker = postMarker(item.turn === "pr-work" ? "pr" : "issue", markerSurface, "automata do-work: working…");
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
    progress(`  noted on issue #${String(item.issue.number)} that the work is on pull request #${String(item.pr?.number ?? 0)}.\n`);
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

  // Linux caps a single argv entry at 128 KiB (MAX_ARG_STRLEN), and the prompt
  // is passed as one. A long-lived issue with many authorized comments can reach
  // that, and the raw failure is an opaque E2BIG from spawn. Fail legibly
  // instead; piping the prompt through stdin is the real fix and is tracked
  // separately.
  const MAX_PROMPT_BYTES = 96 * 1024;
  const promptBytes = Buffer.byteLength(prompt, "utf8");
  if (promptBytes > MAX_PROMPT_BYTES) {
    const detail =
      `the composed prompt is ${String(Math.round(promptBytes / 1024))} KiB, over the ${String(MAX_PROMPT_BYTES / 1024)} KiB ` +
      "limit for a single command-line argument. The conversation is too long to hand to the executor this way.";
    progress(`  failed: ${detail}\n`);
    inFlightMarker = null;
    try {
      updateMarker(
        marker,
        `automata do-work: could not start a run because ${detail} ` +
          "Summarise the discussion in a new issue, or shorten the thread, and try again.",
      );
    } catch (err) {
      progress(`  warning: could not update the marker comment: ${(err as Error).message}\n`);
    }
    return { ...base, outcome: "failed", detail };
  }

  let runError: Error | null = null;
  try {
    await invokeExecutor(prompt, settings, silent);
  } catch (err) {
    runError = err as Error;
  }
  const ranExecutor = true;

  inFlightMarker = null;
  const reconciled = reconcileMarker(item, marker, settings.participants, watermark, runError);
  progress(`  ${reconciled.detail}\n`);

  let outcome = reconciled;
  if (buriedByNote > 0 && outcome.outcome === "answered") {
    outcome = {
      outcome: "answered-no-reply",
      detail: `${outcome.detail} (${String(buriedByNote)} issue message(s) were buried by the pickup note and flagged)`,
      reason: "flagged",
    };
  }
  if (item.turn === "issue-discuss") {
    const linked = repairIssueLink(item, settings.baseBranch);
    // A discuss turn that implemented and opened a pull request has plainly not
    // stalled, even if the model never commented on the issue. Reporting it as
    // "produced no answer" would raise a false alarm; the pull request is the
    // answer, and its `Closes #N` is the durable record.
    // Only a genuine silence is overridden. A flagged mid-run message or an
    // unverified read are real degradations and must keep their exit 2.
    if (linked && outcome.reason === "no-answer") {
      outcome = {
        outcome: "answered",
        detail: "opened a pull request (no issue comment)",
        reason: "answered",
      };
      progress("  a pull request was opened, so the turn is counted as answered.\n");
    }
  }

  return { ...base, outcome: outcome.outcome, detail: outcome.detail, ranExecutor };
}

function summarize(reports: ItemReport[]): void {
  out("\nTick summary:\n");
  if (reports.length === 0) {
    out("  nothing to do\n");
    return;
  }
  for (const report of reports) {
    out(`  #${String(report.issue)} ${report.turn ?? "-"} ${report.outcome} — ${report.detail}\n`);
  }
}

export const doWorkCommand = new Command("do-work")
  .description(
    "Run one tick of the autonomous loop: find the issues whose newest authorized message the agent has not answered, and answer them",
  )
  .option("--with <executor>", "Executor to use: claude or codex (default: from config, else claude)")
  .option("--model <string>", "Model identifier to pass to the executor, overriding the configured default for it")
  .option("--issue <number>", "Restrict the tick to a single issue")
  .option("--limit <n>", "Maximum number of issues to fetch", "10")
  .option("--max-runs <n>", "Maximum number of model runs this tick")
  .option(
    "--dry-run",
    "Print the work plan, plus a summary and the exact command that would be launched for each item, and exit without changing anything",
  )
  .option("--json", "Emit the work plan and outcomes as JSON on stdout")
  .option("--silent", "Suppress step-by-step Claude output; show only the final summary")
  .action(async (options: DoWorkOptions) => {
    const settings = resolveSettings(options);

    // A dry run changes nothing, so it neither needs the lock nor should be
    // blocked by one — being unable to inspect the plan while a tick is running
    // would defeat the primary diagnostic. It also avoids creating the lock file
    // in a repository that has not ignored it.
    if (options.dryRun === true) {
      const exitCode = await runTick(settings, options);
      if (exitCode !== 0) process.exit(exitCode);
      return;
    }

    const lock = acquireRunLock("do-work", settings.lockStaleMinutes);
    if (!lock.ok) {
      // Not a failure: cron firing while a tick is still running is normal.
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
          JSON.stringify(
            { lockHeld: true, suspect: lock.suspect, heldBy: held, plan: [], items: [], exitCode },
            null,
            2,
          ) + "\n",
        );
      } else {
        out(sentence);
        if (suspectSentence) progress(suspectSentence);
      }
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
      const pending = inFlightMarker;
      if (pending !== null) {
        // Leave an explanation rather than a bare "working…" that silently holds
        // the boundary for good.
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
    try {
      exitCode = await runTick(settings, options);
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      exitCode = 1;
    } finally {
      handle.release();
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
    }

    if (exitCode !== 0) process.exit(exitCode);
  });

async function runTick(settings: Settings, options: DoWorkOptions): Promise<number> {
  const issues = discoverIssues(settings);
  const linkMap = getOpenPrLinkMap();

  const decisions = issues.map((issue) =>
    decideWork(buildIssueState(issue, linkMap), settings.participants, {
      baseBranch: settings.baseBranch,
      defaultBranch: linkMap.defaultBranch,
      protectedBranches: settings.protectedBranches,
    }),
  );
  const items = decisions.flatMap((decision) => (decision.kind === "work" ? [decision.item] : []));

  const planText = `Work plan (${String(items.length)} of ${String(issues.length)} issues need an answer):\n${describePlan(decisions)}`;
  if (options.json) {
    progress(planText);
  } else {
    out(planText);
  }

  if (options.dryRun) {
    reportDryRun(items, decisions, settings, options);
    return 0;
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
        issue: item.issue.number,
        title: item.issue.title,
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
    progress(`\n#${String(item.issue.number)} deferred: --max-runs / maxRunsPerTick reached.\n`);
    reports.push({
      issue: item.issue.number,
      title: item.issue.title,
      turn: item.turn,
      outcome: "deferred",
      detail: `run cap of ${String(settings.maxRuns)} reached`,
    });
  }

  // "answered-no-reply" counts as degraded: the run produced nothing, a human has
  // to reply before anything more happens, and an unattended loop must surface
  // that rather than report a healthy tick.
  const degraded = reports.some((report) => report.outcome !== "answered");
  const exitCode = degraded ? 2 : 0;

  if (options.json) {
    out(JSON.stringify({ dryRun: false, plan: decisions.map(toPlanJson), items: reports, exitCode }, null, 2) + "\n");
  } else {
    summarize(reports);
  }

  return exitCode;
}

/** Print (or emit) what a real tick would do, without doing any of it. */
function reportDryRun(
  items: WorkItem[],
  decisions: Decision[],
  settings: Settings,
  options: DoWorkOptions,
): void {
  const describable = settings.maxRuns > 0 ? items.slice(0, settings.maxRuns) : items;
  const planned = describable.map((item) => planRun(item, settings));

  if (options.json) {
    out(
      JSON.stringify(
        {
          dryRun: true,
          plan: decisions.map(toPlanJson),
          runs: planned.map((run, index) => ({
            issue: describable[index].issue.number,
            turn: describable[index].turn,
            executor: settings.executor,
            model: settings.model ?? null,
            bin: run.bin,
            args: run.args,
            command: run.command,
            prompt: run.prompt,
          })),
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  for (const [index, run] of planned.entries()) {
    out("\n" + describePlannedRun(describable[index], settings, run));
  }
  const deferred = items.length - describable.length;
  if (deferred > 0) {
    out(`\n(${String(deferred)} further item(s) deferred by the run cap.)\n`);
  }
  out("\nDry run: nothing was assigned, posted, checked out or executed.\n");
}

function toPlanJson(decision: Decision): Record<string, unknown> {
  if (decision.kind === "skip") {
    return {
      issue: decision.issue.number,
      title: decision.issue.title,
      turn: null,
      skipReason: decision.reason,
      reason: decision.detail,
    };
  }
  const item = decision.item;
  return {
    issue: item.issue.number,
    title: item.issue.title,
    turn: item.turn,
    branch: item.branch,
    pr: item.pr?.number ?? null,
    needsAssignment: item.needsAssignment,
    reason: item.reason,
  };
}
