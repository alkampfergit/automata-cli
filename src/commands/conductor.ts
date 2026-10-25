import { Command } from "commander";
import { azdoUnsupportedMessage, isExplicitGitHub } from "../remote/backend.js";
import {
  readConfig,
  readRawConfig,
  DEFAULT_CONDUCTOR_ISSUE_PROMPT,
  DEFAULT_CONDUCTOR_PR_PROMPT,
  DEFAULT_CONDUCTOR_REBASE_PROMPT,
  DEFAULT_CONDUCTOR_CI_FIX_PROMPT,
  DEFAULT_DO_WORK,
  type AutomataConfig,
} from "../config/configStore.js";
import {
  applyDiscovery,
  getAuthenticatedLogin,
  getIssueSurface,
  getOpenPrLinkMap,
  type OpenPrLinkMap,
  getPrChecks,
  getPrSurface,
  getRepoSlug,
  getStorySource,
  getWatchTarget,
  addLabel,
  removeLabel,
  postMarker,
  type StorySource,
  type WatchTarget,
} from "../github/ghWorkService.js";
import type { Participants } from "../github/conversation.js";
import {
  decideConductorReply,
  isWatchClosed,
  issueConversation,
  loopStateOf,
  prConversation,
  type Conversation,
  type ConductorDecision,
} from "../conductor/replyDecision.js";
import {
  composeConductorPrompt,
  type AgentRequest,
  type ConductorThread,
  type ReplyTarget,
  type ThreadPr,
} from "../conductor/thread.js";
import {
  conductorExecutionProblem,
  describeConductorExecution,
  resolveConductorExecution,
  type ConductorExecution,
} from "../conductor/execution.js";
import { parseInterval, runAutomatic, type TickResult } from "../conductor/automatic.js";
import { conductReply } from "../conductor/reply.js";
import {
  BLOCKED_LABEL,
  coveredByWatchedIssue,
  maxRepliesProblem,
  parseNeedsHuman,
  resolveMaxReplies,
} from "../conductor/loopSafety.js";
import { ciFixMarker, rebaseMarker } from "../conductor/alwaysChecks.js";
import { buildConductorCheck, type WatchedCheck } from "../conductor/checkReport.js";
import { extractDryRunReply } from "../conductor/dryRunReply.js";
import type { LoopState } from "../conductor/loopSafety.js";
import { READY_LABEL, READY_LABEL_DESCRIPTION, readyLabelChange } from "../conductor/readyLabel.js";
import { runClaude } from "../claude/claudeService.js";
import type { RunSink } from "../run/runTranscript.js";
import { parseWatchId, withoutWatched, withWatched } from "../conductor/watchList.js";
import { readStories, readWatch, writeStories, writeWatch } from "../conductor/watchStore.js";
import { checkStories, conductStories, listStoryLines, storyCovered } from "../conductor/storyRunner.js";
import { conductorIdentityProblemFor } from "../github/identity.js";
import { describePermissionDenials, parsePermissionDenials } from "../conductor/permissionDenials.js";
import { describeTracedCommand, startCommandTrace, stopCommandTrace, takeCommandTrace } from "../run/commandTrace.js";
import { acquireConductorLock, CONDUCTOR_LOCK_RELATIVE_PATH, inspectConductorLock, inspectRunLock } from "../run/runLock.js";

function fail(message: string): number {
  process.stderr.write(`Error: ${message}\n`);
  return 1;
}

/**
 * Apply a change to the watch list as it is on disk right now, so a concurrent `add`/`remove`/prune is not overwritten by a stale
 * snapshot taken earlier in the command (the network calls in between are slow).
 */
function updateWatch(change: (current: number[]) => number[]): void {
  const current = readWatch();
  const next = change(current);
  if (next.length === current.length && next.every((id, i) => id === current[i])) return;
  writeWatch(next);
}

function describe(target: WatchTarget): string {
  return `${target.kind === "pr" ? "PR" : "issue"} #${String(target.number)} (${target.state}): ${target.title}`;
}

/**
 * Drop closed issues and closed/merged pull requests from the watch list,
 * logging each removal. An id that cannot be looked up stays: a network error
 * must not empty the list.
 */
export function pruneWatchList(): number[] {
  const watch = readWatch();
  const dropped: number[] = [];
  for (const id of watch) {
    try {
      const target = getWatchTarget(id);
      if (isWatchClosed(target.state)) {
        process.stdout.write(
          `Conductor: dropped ${target.kind === "pr" ? "PR" : "issue"} #${String(id)} from the watch list (closed).\n`,
        );
        dropped.push(id);
      }
    } catch (err) {
      process.stderr.write(`Warning: could not check #${String(id)}, keeping it watched: ${(err as Error).message}\n`);
    }
  }
  if (dropped.length > 0) updateWatch((current) => current.filter((id) => !dropped.includes(id)));
  return watch.filter((id) => !dropped.includes(id));
}

/** The open pull request link map, read on first use. It paginates every open PR, so a report reads it once. */
function onceLinkMap(): () => OpenPrLinkMap {
  let map: OpenPrLinkMap | null = null;
  return () => (map ??= getOpenPrLinkMap());
}

/** One watched item read into a thread, with the conversations the reply rule decides. */
interface WatchedItem {
  target: WatchTarget;
  thread: ConductorThread;
  conversations: Conversation[];
  /** The label names of the watched item itself, for the loop-safety rules. */
  labels: string[];
}

function readPr(number: number): ThreadPr {
  return { surface: getPrSurface(number), checks: getPrChecks(number) };
}

/** A watched issue brings its open linked pull requests; a watched pull request stands alone. */
function readWatchedItem(id: number, linkMap: () => OpenPrLinkMap = getOpenPrLinkMap): WatchedItem {
  const target = getWatchTarget(id);
  if (target.kind === "pr") {
    const pr = readPr(id);
    return { target, thread: { kind: "pr", prs: [pr] }, conversations: [prConversation(pr.surface, pr.checks)], labels: target.labels };
  }
  const issue = getIssueSurface(id);
  const prs = (linkMap().byIssue.get(id) ?? []).map((ref) => readPr(ref.number));
  return {
    target,
    thread: { kind: "issue", issue, prs },
    conversations: [issueConversation(issue), ...prs.map((pr) => prConversation(pr.surface, pr.checks))],
    labels: target.labels,
  };
}

/** The current messages of the conversation a reply goes on. */
function readTargetMessages(target: ReplyTarget) {
  return target.kind === "issue"
    ? issueConversation(getIssueSurface(target.number)).messages
    : prConversation(getPrSurface(target.number)).messages;
}

/** Read-only: the conductor comments, nothing else. `--body-file -` is how it posts without writing a file. */
function runModel(prompt: string, execution: ConductorExecution, replyTo: ReplyTarget, sink: RunSink): Promise<void> {
  const { owner, repo } = getRepoSlug();
  return runClaude(prompt, { model: execution.model, effort: execution.effort, readOnly: true, replyTo, ghRepo: `${owner}/${repo}`, sink, printSteps: verboseRun, echoResult: false });
}

/**
 * Set for the length of one `--verbose` invocation. Process-wide like the command trace,
 * so the item functions need no extra parameter; `runConductor` always clears it.
 */
let verboseRun = false;

/** `--verbose`: the tool calls the permission mode refused, which the model's own summary leaves out. */
function reportDenials(stdout: string, label: string): void {
  if (!verboseRun || stdout.length === 0) return;
  const lines = describePermissionDenials(parsePermissionDenials(stdout));
  if (lines.length === 0) {
    process.stderr.write(`Conductor: the run for ${label} reported no denied tool call.\n`);
    return;
  }
  process.stderr.write(`Conductor: the run for ${label} was denied ${String(lines.length)} tool call(s):\n`);
  for (const line of lines) process.stderr.write(`  - ${line}\n`);
}

/** `--verbose`: every `git` and `gh` call the tick made, with its duration and exit code. */
function reportCommandTrace(): void {
  const trace = takeCommandTrace();
  if (trace === null) return;
  process.stderr.write(`Commands (${String(trace.length)})\n`);
  for (const traced of trace) process.stderr.write(`  ${describeTracedCommand(traced)}\n`);
}

/** A sink that keeps what the run printed on stdout. */
function captureStdout(): { sink: RunSink; text: () => string } {
  let stdout = "";
  const sink: RunSink = {
    output: (stream, text) => {
      if (stream === "stdout") stdout += text;
    },
    exited: () => undefined,
  };
  return { sink, text: () => stdout };
}

/** A dry run: no comment permission, and the model's stdout is the reply, so it is captured. */
async function runModelForText(prompt: string, execution: ConductorExecution): Promise<string | null> {
  const { owner, repo } = getRepoSlug();
  const captured = captureStdout();
  const options = { model: execution.model, effort: execution.effort, readOnly: true, ghRepo: `${owner}/${repo}`, sink: captured.sink, printSteps: verboseRun, echoResult: false };
  try {
    await runClaude(prompt, options);
  } finally {
    reportDenials(captured.text(), "the dry run");
  }
  return extractDryRunReply(execution.executor, captured.text());
}

/** The watched pull requests an issue of the same watch list already covers, with that issue. */
function coveredOf(watch: number[], linkMap: () => OpenPrLinkMap, config: AutomataConfig, participants: Participants): Map<number, number> {
  const canReply = (id: number): boolean => issueCanReply(id, config, participants, linkMap);
  const covered = coveredByWatchedIssue(watch, (id) => (linkMap().byIssue.get(id) ?? []).map((ref) => ref.number), canReply);
  // The current child of a story owns its pull requests, also when it is blocked.
  for (const [pr, child] of storyCovered(config, linkMap)) if (!covered.has(pr)) covered.set(pr, child);
  return covered;
}

/**
 * Whether a watched issue can answer in this tick. A blocked issue, or one at its reply limit, cannot, and then its
 * linked pull requests are decided on their own. A read that fails counts as "can": `conductItem` reports it.
 */
function issueCanReply(id: number, config: AutomataConfig, participants: Participants, linkMap: () => OpenPrLinkMap): boolean {
  try {
    const item = readWatchedItem(id, linkMap);
    const loop = loopStateOf(item.conversations, item.labels, resolveMaxReplies(config.conductor), participants.allowedUsers, config.conductor?.ciFix?.enabled !== false);
    return !loop.blocked && loop.replies < loop.maxReplies;
  } catch {
    return true;
  }
}

function coveredNote(id: number, issue: number): string {
  return `Conductor: #${String(id)} is covered by watched issue #${String(issue)}; its replies, including Copilot review threads, are decided there.`;
}

/** What one dry run shares across its items: the link map, and the conversations it has already answered. */
interface DryRunContext {
  linkMap: () => OpenPrLinkMap;
  answered: Set<string>;
}

function targetKey(target: ReplyTarget): string {
  return `${target.kind}#${String(target.number)}`;
}

/**
 * A blocked item is not ready. The sync ran before the model, so a pull request of the item may carry the
 * label, also one added earlier in this tick. A failed removal is a warning; the next tick reconciles it.
 */
function clearReadyLabels(item: WatchedItem): void {
  for (const pr of item.thread.prs) {
    try {
      removeLabel({ kind: "pr", number: pr.surface.pr.number }, READY_LABEL);
    } catch (err) {
      process.stderr.write(`Warning: could not ${readyPhrase(pr.surface.pr.number, "remove", false)}: ${(err as Error).message}\n`);
    }
  }
}

/** The model needs a person: label the watched item and say nothing on the conversation. */
function blockItem(item: WatchedItem, label: string, reason: string): ItemResult {
  try {
    addLabel(item.target, BLOCKED_LABEL, "The conductor stopped and needs a person; remove this label to resume");
  } catch (err) {
    process.stderr.write(`Error: ${label} needs a human (${reason}) but the ${BLOCKED_LABEL} label was not applied: ${(err as Error).message}\n`);
    return "failed";
  }
  process.stdout.write(`Conductor: ${label} needs a human (${reason}); applied the ${BLOCKED_LABEL} label.\n`);
  clearReadyLabels(item);
  return "idle";
}

/**
 * A rebase or CI-fix turn ended in `NEEDS-HUMAN:`. The always checks ignore the label, so the turn must leave
 * a trace for its head commit, or the next tick would run the model again. The note carries the marker of the turn.
 */
function noteRequestStop(replyTo: ReplyTarget, request: AgentRequest, reason: string, label: string): void {
  const what = request.kind === "rebase" ? "the rebase" : "the CI fix";
  const marker = request.kind === "rebase" ? rebaseMarker(request.headSha) : ciFixMarker(request.headSha);
  try {
    postMarker(replyTo.kind, replyTo.number, `The conductor stopped on ${what} of this pull request and needs a person: ${reason}\n\n${marker}`);
  } catch (err) {
    process.stderr.write(`Warning: could not record the stopped ${what} of ${label}; the next tick tries again: ${(err as Error).message}\n`);
  }
}

type ItemResult = "replied" | "idle" | "failed";

/** Apply one label change; a failed edit throws. */
function applyReadyChange(number: number, change: "add" | "remove"): void {
  const target = { kind: "pr" as const, number };
  if (change === "add") addLabel(target, READY_LABEL, READY_LABEL_DESCRIPTION);
  else removeLabel(target, READY_LABEL);
}

const READY_PHRASES = {
  add: { now: "add the", done: "added the", to: "to" },
  remove: { now: "remove the", done: "removed the", to: "from" },
} as const;

/** The label change as a phrase, for example `add the conductor-ready label to #7`. */
function readyPhrase(number: number, change: "add" | "remove", past: boolean): string {
  const words = READY_PHRASES[change];
  return `${past ? words.done : words.now} ${READY_LABEL} label ${words.to} #${String(number)}`;
}

/** Apply or, in a dry run, report one label change. A failed edit is a warning only: the next tick reconciles it. */
function changeReadyLabel(number: number, change: "add" | "remove", dryRun: boolean): void {
  if (dryRun) {
    process.stdout.write(`Conductor: dry run, a tick would ${readyPhrase(number, change, false)}.\n`);
    return;
  }
  try {
    applyReadyChange(number, change);
    process.stdout.write(`Conductor: ${readyPhrase(number, change, true)}.\n`);
  } catch (err) {
    process.stderr.write(`Warning: could not ${readyPhrase(number, change, false)}: ${(err as Error).message}\n`);
  }
}

/** The labels of a story child, or null when it cannot be read: its pull request is then left alone. */
function childLabels(child: number): string[] | null {
  try {
    return getWatchTarget(child).labels;
  } catch (err) {
    process.stderr.write(`Warning: could not read #${String(child)} for the ${READY_LABEL} label, skipping its pull request: ${(err as Error).message}\n`);
    return null;
  }
}

/**
 * The labels of every watched context of each open pull request: the pull request itself, a watched issue that
 * links it, and the current child of a story. A blocked context blocks the pull request, whichever entry decides.
 * A closed or merged watched pull request is returned apart, for its stale label.
 */
function readyContexts(watch: number[], linkMap: () => OpenPrLinkMap, config: AutomataConfig): { open: Map<number, string[] | null>; closed: WatchTarget[] } {
  const open = new Map<number, string[] | null>();
  const closed: WatchTarget[] = [];
  const add = (pr: number, labels: string[] | null): void => {
    const known = open.get(pr);
    open.set(pr, labels === null || known === null ? null : [...(known ?? []), ...labels]);
  };
  for (const id of watch) {
    let target: WatchTarget;
    try {
      target = getWatchTarget(id);
    } catch (err) {
      process.stderr.write(`Warning: could not check #${String(id)} for the ${READY_LABEL} label: ${(err as Error).message}\n`);
      continue;
    }
    if (isWatchClosed(target.state)) {
      if (target.kind === "pr") closed.push(target);
    } else if (target.kind === "pr") add(id, target.labels);
    else for (const ref of linkMap().byIssue.get(id) ?? []) add(ref.number, target.labels);
  }
  for (const [pr, child] of storyCovered(config, linkMap)) add(pr, childLabels(child));
  return { open, closed };
}

/**
 * Keep the `conductor-ready` label true for every watched pull request. It needs no model and posts no comment,
 * and it does not depend on who may reply: a blocked or limited item, a covered pull request and a pull request
 * that closed are all reconciled. It runs before the prune. A dry run changes nothing.
 */
function reconcileReadyLabels(watch: number[], linkMap: () => OpenPrLinkMap, config: AutomataConfig, dryRun: boolean): void {
  const { open, closed } = readyContexts(watch, linkMap, config);
  for (const target of closed) {
    if (target.labels.some((label) => label.toLowerCase() === READY_LABEL)) changeReadyLabel(target.number, "remove", dryRun);
  }
  for (const [number, labels] of open) {
    if (labels === null) continue;
    try {
      const pr = readPr(number);
      const change = readyLabelChange(pr.surface, pr.checks, labels);
      if (change !== null) changeReadyLabel(number, change, dryRun);
    } catch (err) {
      process.stderr.write(`Warning: could not read #${String(number)} for the ${READY_LABEL} label: ${(err as Error).message}\n`);
    }
  }
}

async function conductDryRunItem(
  prompt: string,
  execution: ConductorExecution,
  label: string,
  where: string,
  replyTo: ReplyTarget,
  dryRun: DryRunContext,
): Promise<ItemResult> {
  const reply = await runModelForText(prompt, execution);
  if (reply === null) {
    process.stderr.write(`Error: the dry run for ${label} produced no reply text.\n`);
    return "failed";
  }
  const needsHuman = parseNeedsHuman(reply);
  if (needsHuman !== null) {
    process.stdout.write(`--- Dry run: ${label} needs a human (not labelled): ${needsHuman} ---\n`);
    return "idle";
  }
  dryRun.answered.add(targetKey(replyTo));
  process.stdout.write(`--- Dry run: reply for ${where} (not posted) ---\n${reply}\n---\n`);
  return "replied";
}

/** The agent is working while its `do-work` run lock is held; a conductor must not start a second turn on its items. */
function agentIsWorking(config: AutomataConfig): boolean {
  const status = inspectRunLock(config.doWork?.lockStaleMinutes ?? DEFAULT_DO_WORK.lockStaleMinutes);
  return status.kind === "held" || status.kind === "suspect";
}

/** The configured instructions for a turn, or the built-in default. */
function frameFor(key: "issue" | "pr" | "rebase" | "ciFix", config: AutomataConfig): string {
  const prompts = config.conductor?.prompts;
  switch (key) {
    case "issue":
      return prompts?.issue ?? DEFAULT_CONDUCTOR_ISSUE_PROMPT;
    case "pr":
      return prompts?.pr ?? DEFAULT_CONDUCTOR_PR_PROMPT;
    case "rebase":
      return prompts?.rebase ?? DEFAULT_CONDUCTOR_REBASE_PROMPT;
    case "ciFix":
      return prompts?.ciFix ?? DEFAULT_CONDUCTOR_CI_FIX_PROMPT;
  }
}

/** The decision to act on: a rebase request, then a CI-fix request, then the first ordinary reply. */
function pickOwedDecision(eligible: ConductorDecision[]): ConductorDecision | undefined {
  return eligible.find((decision) => decision.kind === "rebase") ?? eligible.find((decision) => decision.kind === "ci-fix") ?? eligible[0];
}

/** The line that tells why an item gets no reply this tick. */
function idleMessage(decisions: ConductorDecision[], label: string): string {
  const stopped = decisions.find((decision) => decision.kind === "skip" && decision.reason !== "closed" && decision.reason !== "answered" && decision.reason !== "no-agent-message");
  return stopped?.kind === "skip" ? `Conductor: ${label} gets no reply: ${stopped.detail}.` : `Conductor: ${label} needs no reply.`;
}

async function conductItem(
  id: number,
  config: AutomataConfig,
  login: string,
  participants: Participants,
  execution: ConductorExecution,
  dryRun?: DryRunContext,
  linkMap?: () => OpenPrLinkMap,
): Promise<ItemResult> {
  const label = `#${String(id)}`;
  let item: WatchedItem;
  try {
    item = readWatchedItem(id, dryRun?.linkMap ?? linkMap);
  } catch (err) {
    // As in the prune: a network error is not the run's failure, and the next tick reads it again.
    process.stderr.write(`Warning: could not read ${label}, skipping it this tick: ${(err as Error).message}\n`);
    return "idle";
  }
  const { thread, conversations } = item;
  const loop = loopStateOf(conversations, item.labels, resolveMaxReplies(config.conductor), participants.allowedUsers, config.conductor?.ciFix?.enabled !== false);
  const verdict = decideConductorReply(conversations, participants, loop);
  // A real tick posts its reply, so the next item sees it; a dry run must skip a target it has already answered.
  // A rebase request, then a CI-fix request, come before an ordinary reply, on whichever conversation of the item.
  const eligible = verdict.decisions.filter(
    (decision) => decision.kind !== "skip" && dryRun?.answered.has(targetKey(decision.surface)) !== true,
  );
  const owed = pickOwedDecision(eligible);
  if (owed === undefined) {
    process.stdout.write(`${idleMessage(verdict.decisions, label)}\n`);
    return "idle";
  }
  const request: AgentRequest | undefined = owed.kind === "rebase" || owed.kind === "ci-fix" ? { kind: owed.kind, headSha: owed.headSha } : undefined;
  const copilotTurn = owed.kind === "reply" && owed.copilot === true;
  if ((copilotTurn || request !== undefined) && dryRun === undefined && agentIsWorking(config)) {
    const what = waitingReason(copilotTurn, request);
    process.stdout.write(`Conductor: ${label} ${what}, but the agent is working (the do-work run lock is held); waiting.\n`);
    return "idle";
  }
  const replyTo: ReplyTarget = { kind: owed.surface.kind, number: owed.surface.number };
  const frame = frameFor(frameKey(thread.kind, request), config);
  const prompt = composeConductorPrompt({ thread, repo: getRepoSlug(), participants, frame, replyTo, dryRun: dryRun !== undefined, request });
  const where = `${replyTo.kind === "pr" ? "pull request" : "issue"} #${String(replyTo.number)}`;

  const need = needLabel(request);
  process.stdout.write(`Conductor: ${label} needs ${need} on ${where}; running ${describeConductorExecution(execution)}.\n`);
  if (dryRun) return conductDryRunItem(prompt, execution, label, where, replyTo, dryRun);
  const captured = captureStdout();
  const outcome = await conductReply({
    login,
    read: () => readTargetMessages(replyTo),
    run: () => runModel(prompt, execution, replyTo, captured.sink),
  });
  reportDenials(captured.text(), label);
  const needsHuman = parseNeedsHuman(extractDryRunReply(execution.executor, captured.text()) ?? "");
  if (needsHuman !== null && outcome.kind !== "run-failed" && outcome.kind !== "unverified") {
    if (request !== undefined) noteRequestStop(replyTo, request, needsHuman, label);
    return blockItem(item, label, needsHuman);
  }
  switch (outcome.kind) {
    case "posted":
      process.stdout.write(`Conductor: posted a reply on ${where}.\n`);
      if (outcome.runError !== null) {
        process.stderr.write(`Warning: the run reported "${outcome.runError}" but the reply is posted.\n`);
      }
      return "replied";
    case "posted-nothing":
      process.stderr.write(`Error: the run for ${label} finished but posted no comment on ${where}.\n`);
      return "failed";
    case "run-failed":
      process.stderr.write(`Error: the run for ${label} failed and posted no comment on ${where}: ${outcome.error}\n`);
      return "failed";
    case "unverified":
      process.stderr.write(`Error: could not tell whether ${label} got a reply: ${outcome.error}\n`);
      return "failed";
  }
}

/** Config shared by `add` and `list`: GitHub mode and a discovery setting that can be applied. */
function loadGitHubConfig(): AutomataConfig | number {
  const config = readRawConfig();
  if (!isExplicitGitHub(config)) {
    return fail(
      azdoUnsupportedMessage(
        "conductor",
        "It needs the GitHub APIs; set the remote with `automata config set type gh`.",
      ),
    );
  }
  return config;
}

export function runWatchAdd(rawId: string): number {
  const id = parseWatchId(rawId);
  if (id === null) return fail(`"${rawId}" is not an issue or pull request number.`);
  const config = loadGitHubConfig();
  if (typeof config === "number") return config;
  const technique = config.issueDiscoveryTechnique;
  if (!technique) return fail("No issue discovery technique configured. Run `automata config`.");
  const value = (config.issueDiscoveryValue ?? "").trim();
  if (technique !== "title-contains" && value.length === 0) {
    return fail("No issue discovery value configured. Run `automata config`.");
  }
  try {
    const target = getWatchTarget(id);
    if (target.state === "closed") return fail(`${describe(target)} is closed; nothing to watch.`);
    if (target.kind === "issue") {
      const story = getStorySource(id);
      if (story.children.length > 0) return addStory(id, story, technique);
    }
    // Resolve the linked PRs first: a failure here must leave GitHub untouched.
    const followed =
      target.kind === "issue"
        ? (getOpenPrLinkMap().byIssue.get(id) ?? []).map((pr) => pr.number)
        : [];
    applyDiscovery(target, technique, value);
    updateWatch((current) => withWatched(current, id, ...followed));
    process.stdout.write(`Watching ${describe(target)}.\n`);
    for (const pr of followed) process.stdout.write(`Also following linked PR #${String(pr)}.\n`);
    return 0;
  } catch (err) {
    return fail((err as Error).message);
  }
}

/** The parent has children: store it as a story. Only the children are given to `do-work`, one at a time. */
function addStory(id: number, story: StorySource, technique: string): number {
  if (technique === "title-contains") {
    return fail("issueDiscoveryTechnique `title-contains` cannot be applied to an existing item; use `label` or `assignee`.");
  }
  // A parent that was watched as an ordinary item is promoted: it gets story processing only.
  updateWatch((current) => withoutWatched(current, id));
  const stories = readStories();
  writeStories(stories.includes(id) ? stories : [...stories, id]);
  const first = story.children.find((child) => child.state === "open");
  const next = first === undefined ? "all are closed, so a tick closes it" : `first open child is #${String(first.number)}`;
  process.stdout.write(`Watching story #${String(id)} (${story.title}): ${String(story.children.length)} children via ${story.via}; ${next}.\n`);
  return 0;
}

export function runWatchRemove(rawId: string): number {
  const id = parseWatchId(rawId);
  if (id === null) return fail(`"${rawId}" is not an issue or pull request number.`);
  const before = readWatch();
  if (readStories().includes(id)) {
    writeStories(withoutWatched(readStories(), id));
    process.stdout.write(`Stopped watching story #${String(id)}.\n`);
    return 0;
  }
  if (!before.includes(id)) return fail(`#${String(id)} is not on the watch list.`);
  updateWatch((current) => withoutWatched(current, id));
  process.stdout.write(`Stopped watching #${String(id)}.\n`);
  return 0;
}

export function runWatchList(): number {
  const config = loadGitHubConfig();
  if (typeof config === "number") return config;
  const watch = readWatch();
  const storyLines = listStoryLines(config, onceLinkMap());
  if (watch.length === 0 && storyLines.length === 0) {
    process.stdout.write("The watch list is empty.\n");
    return 0;
  }
  for (const line of storyLines) process.stdout.write(`${line}\n`);
  for (const id of watch) {
    try {
      process.stdout.write(`${describe(getWatchTarget(id))}\n`);
    } catch (err) {
      process.stdout.write(`#${String(id)}: unavailable (${(err as Error).message})\n`);
    }
  }
  return 0;
}

function exitWith(code: number): void {
  if (code !== 0) process.exit(code);
}

interface Preflight {
  config: AutomataConfig;
  login: string;
  participants: Participants;
  execution: ConductorExecution;
}

/** Everything a tick checks before it takes the lock: the first problem found, or the resolved settings. */
function preflight(): Preflight | { problem: string } {
  let config;
  try {
    config = readConfig();
  } catch (err) {
    return { problem: (err as Error).message };
  }

  if (!isExplicitGitHub(config)) {
    return {
      problem: azdoUnsupportedMessage(
        "conductor",
        "It needs the GitHub APIs; set the remote with `automata config set type gh`.",
      ),
    };
  }

  const allowedUsers = (config.allowedUsers ?? []).filter((user) => user.trim().length > 0);
  if (allowedUsers.length === 0) {
    return { problem: "No allowed users configured. Run `automata config set allowed-users <user1,user2>`." };
  }
  const agentUser = (config.agentUser ?? "").trim();
  if (agentUser.length === 0) {
    return { problem: "No agent user configured. Run `automata config set agent-user <login>`." };
  }

  let login: string | null;
  try {
    login = getAuthenticatedLogin();
  } catch (err) {
    return { problem: `\`gh\` could not be queried: ${(err as Error).message}` };
  }
  const identityProblem = conductorIdentityProblemFor(login, agentUser, allowedUsers);
  if (identityProblem !== null) return { problem: identityProblem };

  // Hand-edited JSON: apply the same rule `do-work` does (a positive safe integer).
  const rawStale: unknown = config.doWork?.lockStaleMinutes;
  if (rawStale !== undefined && rawStale !== null) {
    if (typeof rawStale !== "number" || !Number.isSafeInteger(rawStale) || rawStale < 1) {
      return { problem: `doWork.lockStaleMinutes must be a positive integer, got ${JSON.stringify(rawStale)}.` };
    }
  }
  const executionProblem = conductorExecutionProblem(config.conductor);
  if (executionProblem !== null) return { problem: executionProblem };
  const maxReplies = maxRepliesProblem(config.conductor);
  if (maxReplies !== null) return { problem: maxReplies };
  if (config.conductor?.executor === "codex") {
    // Codex has no command allow-list: a prompt-injected run could merge, close or comment elsewhere.
    return { problem: "conductor.executor codex is not supported: Codex cannot be limited to comments on the reply target. Use claude." };
  }
  return {
    config,
    login: login ?? "",
    participants: { allowedUsers, agentUser },
    execution: resolveConductorExecution(config.conductor),
  };
}

export interface ConductorOptions {
  check?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  automatic?: boolean;
  /** Seconds, as typed; only with `automatic`. */
  interval?: string;
}

function staleMinutesOf(config: AutomataConfig): number {
  return config.doWork?.lockStaleMinutes ?? DEFAULT_DO_WORK.lockStaleMinutes;
}

/** Read one watched id the way a tick would, without changing anything. */
function checkWatched(
  id: number,
  participants: Participants,
  maxReplies: number,
  ciFixEnabled: boolean,
  linkMap: () => OpenPrLinkMap,
  coveredBy?: number,
): WatchedCheck {
  try {
    const target = getWatchTarget(id);
    if (isWatchClosed(target.state)) return { id, kind: target.kind, state: "closed", decisions: [] };
    if (coveredBy !== undefined) return { id, kind: target.kind, state: "open", decisions: [], coveredBy };
    const { conversations, labels } = readWatchedItem(id, linkMap);
    const loop: LoopState = loopStateOf(conversations, labels, maxReplies, participants.allowedUsers, ciFixEnabled);
    return { id, kind: target.kind, state: "open", decisions: decideConductorReply(conversations, participants, loop).decisions };
  } catch (err) {
    return { id, unavailable: (err as Error).message };
  }
}

/** `--check`: a read-only report of what a tick would do. No lock, no prune, no comment, no model. */
function runConductorCheck(): number {
  const checked = preflight();
  const generatedAt = new Date();
  let repo: string | null = null;
  try {
    const slug = getRepoSlug();
    repo = `${slug.owner}/${slug.repo}`;
  } catch {
    // the header says "unknown repository"
  }
  const linkMap = onceLinkMap();
  const watchIds = "problem" in checked ? [] : readWatch({ migrate: false });
  const covered = "problem" in checked ? new Map<number, number>() : coveredOf(watchIds, linkMap, checked.config, checked.participants);
  const report =
    "problem" in checked
      ? buildConductorCheck({
          generatedAt, repo, configProblem: checked.problem, identity: "", execution: "",
          lock: { kind: "free" }, staleMinutes: DEFAULT_DO_WORK.lockStaleMinutes, watched: [], stories: [],
        })
      : buildConductorCheck({
          generatedAt, repo, configProblem: null,
          identity: checked.login,
          execution: describeConductorExecution(checked.execution),
          lock: inspectConductorLock(staleMinutesOf(checked.config)),
          staleMinutes: staleMinutesOf(checked.config),
          watched: watchIds.map((id) => checkWatched(id, checked.participants, resolveMaxReplies(checked.config.conductor), checked.config.conductor?.ciFix?.enabled !== false, linkMap, covered.get(id))),
          stories: checkStories(checked.config, linkMap),
        });
  process.stdout.write(report.text);
  return report.exitCode;
}

/** Conduct one item and report whether it failed; an error is printed, not thrown, so the other items still run. */
async function conductSafely(id: number, conduct: () => Promise<string>): Promise<boolean> {
  try {
    return (await conduct()) === "failed";
  } catch (err) {
    process.stderr.write(`Error: #${String(id)} could not be conducted: ${(err as Error).message}\n`);
    return true;
  }
}

/**
 * Run `step` for each id, one after the other, and count the failures. The chain is sequential on purpose: each step
 * reads and writes the same account's conversations.
 */
function conductInOrder(ids: readonly number[], step: (id: number) => Promise<boolean>): Promise<number> {
  return ids.reduce(async (previous, id) => (await previous) + ((await step(id)) ? 1 : 0), Promise.resolve(0));
}

/** `--dry-run`: the tick without its effects. A live lock is a warning, not a stop, because nothing is written. */
async function runConductorDryRun(checked: Preflight): Promise<number> {
  const { config, login, participants, execution } = checked;
  const lock = inspectConductorLock(staleMinutesOf(config));
  if (lock.kind === "held" || lock.kind === "suspect") {
    process.stderr.write(`Warning: a conductor is running here (pid ${String(lock.owner.pid)}); the dry run does not take the lock.\n`);
  }
  process.stdout.write(`Conductor: dry run as ${login}; nothing is posted and the watch list is not changed.\n`);
  const context: DryRunContext = { linkMap: onceLinkMap(), answered: new Set() };
  const watchIds = readWatch({ migrate: false });
  reconcileReadyLabels(watchIds, context.linkMap, config, true);
  const covered = coveredOf(watchIds, context.linkMap, config, participants);
  const conduct = (id: number): Promise<boolean> =>
    conductSafely(id, () => conductItem(id, config, login, participants, execution, context));
  let failed = await conductInOrder(watchIds, async (id) => {
    try {
      if (isWatchClosed(getWatchTarget(id).state)) {
        process.stdout.write(`Conductor: #${String(id)} is closed; a tick would drop it from the watch list.\n`);
        return false;
      }
    } catch {
      // As in the prune: an id that cannot be looked up stays, and conductItem reports the read failure.
    }
    const coveredBy = covered.get(id);
    if (coveredBy !== undefined) {
      process.stdout.write(`${coveredNote(id, coveredBy)}\n`);
      return false;
    }
    return conduct(id);
  });
  const stories = conductStories(config, context.linkMap, true);
  failed += stories.failed;
  failed += await conductInOrder(
    stories.active.filter((child) => !watchIds.includes(child)),
    conduct,
  );
  return failed > 0 ? 1 : 0;
}

function reportHeldLock(held: { pid: number; host: string; startedAt: string }, suspect: boolean, staleMinutes: number): number {
  process.stdout.write(
    `Another conductor is already running here (pid ${String(held.pid)} on ${held.host}, ` +
      `started ${held.startedAt}). Doing nothing.\n`,
  );
  if (!suspect) return 0;
  process.stderr.write(
    `Warning: that lock has been held longer than ${String(staleMinutes)} minutes. If no tick is really ` +
      `running, its process id was probably reused; remove ${CONDUCTOR_LOCK_RELATIVE_PATH} once you have confirmed that.\n`,
  );
  return 2;
}

/**
 * One conductor tick. Returns the exit code rather than exiting, so the lock is
 * always released on the way out.
 *
 * Pre-flight (configuration, identity, lock), prune the watch list, then answer
 * each watched item whose newest message is the agent's: the model runs read-only
 * and posts the reply itself. The tick exits 1 when a run failed or posted nothing.
 *
 * `--check` only reports (see `runConductorCheck`). `--dry-run` runs the model for
 * the reply a tick would post for each watched item, but posts nothing, and changes nothing: no lock, no prune.
 */
export async function runConductor(options: ConductorOptions = {}): Promise<number> {
  verboseRun = options.verbose === true;
  if (verboseRun) startCommandTrace();
  try {
    return await runConductorTick(options);
  } finally {
    // In `finally` so an unexpected failure still prints the trace.
    reportCommandTrace();
    verboseRun = false;
    stopCommandTrace();
  }
}

async function runConductorTick(options: ConductorOptions): Promise<number> {
  const problem = optionsProblem(options);
  if (problem !== null) return fail(problem);
  if (options.automatic === true) return runConductorAutomatic(options.interval);
  if (options.check === true) return runConductorCheck();
  return (await runTick(options)).code;
}

function optionsProblem(options: ConductorOptions): string | null {
  if (options.check === true && options.dryRun === true) return "--check and --dry-run cannot be used together.";
  if (options.automatic !== true) {
    return options.interval === undefined ? null : "--interval needs --automatic.";
  }
  if (options.check === true || options.dryRun === true) return "--automatic cannot be used with --check or --dry-run.";
  const interval = parseInterval(options.interval);
  return typeof interval === "string" ? interval : null;
}

/** `--automatic`: ticks until no open item is watched, or until SIGINT/SIGTERM. */
async function runConductorAutomatic(rawInterval: string | undefined): Promise<number> {
  const intervalSeconds = parseInterval(rawInterval) as number;
  let stop = false;
  let wake: (() => void) | null = null;
  const onSignal = (): void => {
    if (stop) process.exit(130);
    stop = true;
    process.stdout.write("Conductor: stopping after the current tick.\n");
    wake?.();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    process.stdout.write(`Conductor: automatic mode, one tick every ${String(intervalSeconds)} s. Press Ctrl+C to stop.\n`);
    return await runAutomatic({
      intervalSeconds,
      tick: () => runTick({}),
      stopped: () => stop,
      log: (line) => process.stdout.write(`${line}\n`),
      sleep: (seconds) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, seconds * 1000);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        }),
    });
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}

async function runTick(options: ConductorOptions): Promise<TickResult> {
  const checked = preflight();
  if ("problem" in checked) return { code: fail(checked.problem), open: null };
  if (options.dryRun === true) return { code: await runConductorDryRun(checked), open: null };
  const { config, login, participants, execution } = checked;
  const staleMinutes = config.doWork?.lockStaleMinutes ?? DEFAULT_DO_WORK.lockStaleMinutes;
  const lock = acquireConductorLock(staleMinutes);
  if (!lock.ok) return { code: reportHeldLock(lock.heldBy, lock.suspect, staleMinutes), open: null };

  try {
    process.stdout.write(`Conductor: running as ${login}.\n`);
    const linkMap = onceLinkMap();
    reconcileReadyLabels(readWatch(), linkMap, config, false);
    const watch = pruneWatchList();
    const covered = coveredOf(watch, linkMap, config, participants);
    const conduct = (id: number): Promise<boolean> =>
      conductSafely(id, () => conductItem(id, config, login, participants, execution, undefined, linkMap));
    // One item at a time on purpose: each run reads and writes the same account's conversations.
    let failed = await conductInOrder(watch, (id) => {
      const coveredBy = covered.get(id);
      if (coveredBy === undefined) return conduct(id);
      process.stdout.write(`${coveredNote(id, coveredBy)}\n`);
      return Promise.resolve(false);
    });
    const stories = conductStories(config, linkMap, false);
    // The active child and its linked pull requests get the ordinary conductor processing.
    failed += await conductInOrder(
      stories.active.filter((child) => !watch.includes(child)),
      conduct,
    );
    return { code: failed + stories.failed > 0 ? 1 : 0, open: watch.length + stories.open };
  } finally {
    lock.handle.release();
  }
}

export const conductorCommand = new Command("conductor")
  .description(
    "Run one conductor tick as an allowed (human) account: verify the identity, take the conductor's own run lock, then act",
  )
  .option("--check", "Report what a tick would do, including pending prunes, and change nothing; exit 1 on a problem")
  .option("--dry-run", "Run the model for each owed reply and print it instead of posting; no lock, no prune")
  .option(
    "--verbose",
    "Trace every `git` and `gh` call with its duration and exit code, show the model's steps, and list the tool calls the run was denied",
  )
  .option("--automatic", "Run a tick every --interval seconds until no open item is watched (Ctrl+C stops it)")
  .option("--interval <seconds>", "Seconds between two ticks with --automatic (default 60)")
  .action(async (options: ConductorOptions) => {
    exitWith(await runConductor(options));
  });

conductorCommand
  .command("add <id>")
  .description("Watch an issue or pull request and make do-work pick it up (an issue also follows its linked PR; a parent with children becomes a story)")
  .action((id: string) => {
    exitWith(runWatchAdd(id));
  });

conductorCommand
  .command("remove <id>")
  .description("Stop watching an issue or pull request (the discovery label/assignee is left alone)")
  .action((id: string) => {
    exitWith(runWatchRemove(id));
  });

conductorCommand
  .command("list")
  .description("List the watched issues and pull requests")
  .action(() => {
    exitWith(runWatchList());
  });

/** Why a turn waits for the agent: an open Copilot thread, a failed check or a merge conflict. */
function waitingReason(copilotTurn: boolean, request: AgentRequest | undefined): string {
  if (copilotTurn) return "has open Copilot review threads";
  return request?.kind === "ci-fix" ? "has a failed check" : "has a merge conflict";
}

/** The prompt frame of a turn: the thread kind, or the kind of the request to the agent. */
function frameKey(threadKind: "issue" | "pr", request: AgentRequest | undefined): "issue" | "pr" | "rebase" | "ciFix" {
  if (request === undefined) return threadKind;
  return request.kind === "ci-fix" ? "ciFix" : "rebase";
}

/** What the item is owed, for the progress line. */
function needLabel(request: AgentRequest | undefined): string {
  if (request === undefined) return "a reply";
  return request.kind === "rebase" ? "a rebase request" : "a CI-fix request";
}
