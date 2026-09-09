import { Command } from "commander";
import {
  readConfig,
  DEFAULT_DO_WORK,
  DEFAULT_DO_WORK_ISSUE_DISCUSS_PROMPT,
  DEFAULT_DO_WORK_PR_WORK_PROMPT,
  type AutomataConfig,
  type Executor,
  type TurnKind,
  type AutomataDoWorkConfig,
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
  type PullRequestRef,
} from "../github/ghWorkService.js";
import type { RawMessage, Participants } from "../github/conversation.js";
import type { IssueSurface } from "../github/ghWorkService.js";
import {
  agentAnsweredAfter,
  decideWork,
  selectLinkedPr,
  type Decision,
  type IssueState,
  type WorkItem,
} from "../github/workDetection.js";
import { composePrompt } from "../github/workPrompt.js";
import { prepareBaseBranch, preparePrBranch } from "../git/workspaceService.js";
import { getCurrentBranch } from "../git/gitService.js";
import { acquireRunLock, type LockHandle } from "../run/runLock.js";
import { runClaude, buildClaudeArgs, resolveCommand } from "../claude/claudeService.js";
import { runCodex, buildCodexArgs } from "../codex/codexService.js";
import { terminateTrackedChildren } from "../cli/childRegistry.js";
import { shellQuote } from "../cli/spawnUtils.js";

type Outcome = "answered" | "answered-no-reply" | "skipped" | "failed" | "deferred";

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

  const doWork = config.doWork ?? {};
  validateDoWorkConfig(doWork);

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
 * A login that merely differs from `agentUser` is only a warning: the agent
 * would not recognise its own messages (so it would repeat itself), but nothing
 * escalates. An unknown login is not an error at all — a GitHub App
 * installation token has no user.
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
function validateDoWorkConfig(doWork: AutomataDoWorkConfig): void {
  if (doWork.executor !== undefined && doWork.executor !== "claude" && doWork.executor !== "codex") {
    fail(`doWork.executor must be 'claude' or 'codex', got '${String(doWork.executor)}'.`);
  }

  if (doWork.baseBranch !== undefined && doWork.baseBranch.trim().length === 0) {
    fail("doWork.baseBranch must not be empty.");
  }

  if (doWork.maxRunsPerTick !== undefined) {
    if (!Number.isSafeInteger(doWork.maxRunsPerTick) || doWork.maxRunsPerTick < 0) {
      fail(
        `doWork.maxRunsPerTick must be a non-negative integer (0 = unlimited), got ${String(doWork.maxRunsPerTick)}.`,
      );
    }
  }

  if (doWork.lockStaleMinutes !== undefined) {
    if (!Number.isSafeInteger(doWork.lockStaleMinutes) || doWork.lockStaleMinutes <= 0) {
      fail(`doWork.lockStaleMinutes must be a positive integer, got ${String(doWork.lockStaleMinutes)}.`);
    }
  }

  for (const [key, value] of [
    ["doWork.models.claude", doWork.models?.claude],
    ["doWork.models.codex", doWork.models?.codex],
    ["doWork.prompts.issueDiscuss", doWork.prompts?.issueDiscuss],
    ["doWork.prompts.prWork", doWork.prompts?.prWork],
  ] as const) {
    if (value !== undefined && (typeof value !== "string" || value.trim().length === 0)) {
      fail(`${key} must be a non-empty string.`);
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

function buildIssueState(issue: GitHubIssue, linkMap: Map<number, PullRequestRef[]>): IssueState {
  const issueSurface = getIssueSurface(issue.number);
  const linkedPrs = linkMap.get(issue.number) ?? [];
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
 * Re-decide one item against the current state of GitHub.
 *
 * Returns a skip when the issue has since been closed or answered, which is the
 * right outcome: the plan said there was work, and there no longer is.
 */
function refreshItem(
  item: WorkItem,
  settings: Settings,
  linkMap: Map<number, PullRequestRef[]>,
): Decision {
  return decideWork(
    buildIssueState(item.issue, linkMap),
    settings.participants,
    settings.baseBranch,
  );
}

/** Re-read the surface the turn answered, flattened for the answer predicate. */
function readAnsweringSurface(item: WorkItem): RawMessage[] {
  if (item.turn === "issue-discuss" || item.pr === null) {
    return getIssueSurface(item.issue.number).messages;
  }
  const surface = getPrSurface(item.pr.number);
  return [...surface.messages, ...surface.threads.flatMap((thread) => thread.comments)];
}

/**
 * Decide what becomes of the "working" marker now the run is over.
 *
 * The marker is the boundary while the run is in flight. Once the model has
 * posted its own answer, that answer is newer and holds the boundary, so the
 * marker is noise and is removed. When nothing was posted, the marker is the
 * only thing that can tell the humans what happened, so it is updated in place —
 * which keeps its creation time, and therefore the boundary, so a failing run is
 * not retried automatically on every later tick.
 */
/** Which surface the turn answers, for marker text that points somewhere real. */
function markerSurfaceLabel(item: WorkItem): string {
  return item.turn === "pr-work" && item.pr
    ? `pull request #${String(item.pr.number)}`
    : `issue #${String(item.issue.number)}`;
}

function reconcileMarker(
  item: WorkItem,
  marker: MarkerRef,
  agentUser: string,
  runError: Error | null,
): { outcome: Outcome; detail: string } {
  let answered: boolean | "unknown";
  try {
    answered = agentAnsweredAfter(readAnsweringSurface(item), agentUser, marker);
  } catch (err) {
    progress(
      `  warning: could not re-read issue #${String(item.issue.number)} to check for an answer: ${(err as Error).message}\n`,
    );
    // Unknown is not the same as "no answer": an answer may exist and the read
    // may simply have failed. Never delete the marker here — a stale marker is
    // harmless, a lost boundary is not — but do not assert anything either.
    answered = "unknown";
  }

  if (answered === "unknown") {
    const surface = markerSurfaceLabel(item);
    try {
      updateMarker(
        marker,
        `automata do-work: the agent run finished, but automata could not read ${surface} afterwards ` +
          "to confirm whether an answer was posted. Check this thread and the branch before assuming either. " +
          "Reply here to have another attempt made.",
      );
    } catch (updateErr) {
      progress(`  warning: could not update the marker comment: ${(updateErr as Error).message}\n`);
    }
    return { outcome: "answered-no-reply", detail: "could not verify whether an answer was posted" };
  }

  if (answered) {
    try {
      deleteMarker(marker);
    } catch (err) {
      progress(`  warning: could not delete the marker comment: ${(err as Error).message}\n`);
    }
    return runError === null
      ? { outcome: "answered", detail: "answered" }
      : { outcome: "answered", detail: `answered, but the run reported: ${runError.message}` };
  }

  // Deliberately does not claim nothing changed: a run can commit and push and
  // still fail to comment, and a failed run can leave partial work behind.
  const surface = markerSurfaceLabel(item);
  const explanation =
    runError === null
      ? `automata do-work: the agent run finished without posting an answer on ${surface}. ` +
        `It may still have changed the branch \`${item.branch}\` — check it before assuming otherwise. ` +
        `Reply on ${surface} to have another attempt made.`
      : `automata do-work: the agent run failed before posting an answer (${runError.message}). ` +
        `It may have left partial changes on the branch \`${item.branch}\`. ` +
        `Reply on ${surface} to have another attempt made.`;
  try {
    updateMarker(marker, explanation);
  } catch (err) {
    progress(
      `  warning: could not update the marker comment on issue #${String(item.issue.number)}: ${(err as Error).message}\n` +
        `  the humans have not been told that this run produced no answer.\n`,
    );
  }

  return runError === null
    ? { outcome: "answered-no-reply", detail: "run finished but posted no answer" }
    : { outcome: "failed", detail: `run failed: ${runError.message}` };
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
function repairIssueLink(item: WorkItem, baseBranch: string): void {
  try {
    const branch = getCurrentBranch();
    if (branch === baseBranch) {
      progress(`  issue #${String(item.issue.number)} is still in discussion (no branch was created).\n`);
      return;
    }

    const pr = getCurrentBranchPr();
    if (!pr) {
      progress(`  issue #${String(item.issue.number)} is still in discussion (no pull request).\n`);
      return;
    }
    if (pr.body.includes(`Closes #${String(item.issue.number)}`)) {
      progress(`  pull request #${String(pr.number)} already closes issue #${String(item.issue.number)}.\n`);
      return;
    }
    addClosesRefToPr(pr.number, item.issue.number);
    progress(`  linked pull request #${String(pr.number)} to issue #${String(item.issue.number)}.\n`);
  } catch (err) {
    progress(`  warning: could not link a pull request to issue #${String(item.issue.number)}: ${(err as Error).message}\n`);
  }
}

async function processItem(
  planned: WorkItem,
  settings: Settings,
  linkMap: Map<number, PullRequestRef[]>,
  silent: boolean,
): Promise<ItemReport> {
  const base: Pick<ItemReport, "issue" | "title" | "turn"> = {
    issue: planned.issue.number,
    title: planned.issue.title,
    turn: planned.turn,
  };
  progress(`\n#${String(planned.issue.number)} ${planned.turn}: ${planned.reason}\n`);

  // The tick's plan was built before any model ran, and an earlier item can take
  // a long time. Re-read this issue now, so a message that arrived in the
  // meantime is answered rather than being buried behind the marker we are about
  // to post — which would make it older than the boundary and never new again.
  const refreshed = refreshItem(planned, settings, linkMap);
  if (refreshed.kind === "skip") {
    progress(`  skipped: ${refreshed.detail}\n`);
    return { ...base, outcome: "skipped", detail: `no longer actionable: ${refreshed.detail}` };
  }
  const item = refreshed.item;
  if (item.turn !== planned.turn) {
    progress(`  turn changed to ${item.turn} since the plan was built; using the current state.\n`);
  }

  const prepared =
    item.turn === "issue-discuss" ? prepareBaseBranch(item.branch) : preparePrBranch(item.branch);
  if (!prepared.ok) {
    progress(`  skipped: ${prepared.reason} — ${prepared.detail}\n`);
    return { ...base, outcome: "skipped", detail: `${prepared.reason}: ${prepared.detail}` };
  }

  if (item.needsAssignment) {
    try {
      assignIssueToAgent(item.issue.number, settings.participants.agentUser);
      progress(`  assigned issue #${String(item.issue.number)} to ${settings.participants.agentUser}.\n`);
    } catch (err) {
      // Assignment is a visible claim, not a correctness mechanism: a repository
      // where the agent lacks write access must still be able to run the loop.
      progress(`  warning: could not assign issue #${String(item.issue.number)}: ${(err as Error).message}\n`);
    }
  }

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

  const prompt = composePrompt({
    item,
    repo: getRepoSlug(),
    agentUser: settings.participants.agentUser,
    baseBranch: settings.baseBranch,
    frame: settings.prompts[item.turn],
  });

  let runError: Error | null = null;
  try {
    await invokeExecutor(prompt, settings, silent);
  } catch (err) {
    runError = err as Error;
  }

  const reconciled = reconcileMarker(item, marker, settings.participants.agentUser, runError);
  progress(`  ${reconciled.detail}\n`);

  if (item.turn === "issue-discuss") {
    repairIssueLink(item, settings.baseBranch);
  }

  return { ...base, outcome: reconciled.outcome, detail: reconciled.detail };
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

    const lock = acquireRunLock("do-work", settings.lockStaleMinutes);
    if (!lock.ok) {
      // Not a failure: cron firing while a tick is still running is normal.
      out(
        `Another automata instance is already running here (pid ${String(lock.heldBy.pid)} on ` +
          `${lock.heldBy.host}, started ${lock.heldBy.startedAt}, command ${lock.heldBy.command}). Doing nothing.\n`,
      );
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
      void terminateTrackedChildren().then(() => {
        handle.release();
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

  const decisions = issues.map((issue) => decideWork(buildIssueState(issue, linkMap), settings.participants, settings.baseBranch));
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

  const runnable = settings.maxRuns > 0 ? items.slice(0, settings.maxRuns) : items;
  const deferred = items.slice(runnable.length);

  const reports: ItemReport[] = [];
  for (const item of runnable) {
    reports.push(await processItem(item, settings, linkMap, options.silent === true));
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
