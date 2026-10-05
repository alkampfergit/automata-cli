import { Command } from "commander";
import { azdoUnsupportedMessage, isExplicitGitHub } from "../remote/backend.js";
import {
  readConfig,
  readRawConfig,
  writeConfig,
  DEFAULT_CONDUCTOR_ISSUE_PROMPT,
  DEFAULT_CONDUCTOR_PR_PROMPT,
  DEFAULT_DO_WORK,
  type AutomataConfig,
} from "../config/configStore.js";
import {
  applyDiscovery,
  getAuthenticatedLogin,
  getIssueSurface,
  getOpenPrLinkMap,
  getPrChecks,
  getPrSurface,
  getRepoSlug,
  getWatchTarget,
  type WatchTarget,
} from "../github/ghWorkService.js";
import type { Participants } from "../github/conversation.js";
import {
  decideConductorReply,
  isWatchClosed,
  issueConversation,
  prConversation,
  type Conversation,
} from "../conductor/replyDecision.js";
import {
  composeConductorPrompt,
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
import { conductReply } from "../conductor/reply.js";
import { buildConductorCheck, type WatchedCheck } from "../conductor/checkReport.js";
import { extractDryRunReply } from "../conductor/dryRunReply.js";
import { runClaude } from "../claude/claudeService.js";
import { normalizeWatch, parseWatchId, withoutWatched, withWatched } from "../conductor/watchList.js";
import { conductorIdentityProblemFor } from "../github/identity.js";
import { acquireConductorLock, CONDUCTOR_LOCK_RELATIVE_PATH, inspectConductorLock } from "../run/runLock.js";

function fail(message: string): number {
  process.stderr.write(`Error: ${message}\n`);
  return 1;
}

/**
 * Apply a change to the watch list against the config as it is on disk right
 * now, so a concurrent `add`/`remove`/prune is not overwritten by a stale
 * snapshot taken earlier in the command (the network calls in between are slow).
 */
function updateWatch(change: (current: number[]) => number[]): void {
  const raw = readRawConfig();
  const current = normalizeWatch(raw.conductor?.watch);
  const next = change(current);
  if (next.length === current.length && next.every((id, i) => id === current[i])) return;
  writeConfig({ ...raw, conductor: { ...raw.conductor, watch: next } });
}

function describe(target: WatchTarget): string {
  return `${target.kind === "pr" ? "PR" : "issue"} #${String(target.number)} (${target.state}): ${target.title}`;
}

/**
 * Drop closed issues and closed/merged pull requests from `conductor.watch`,
 * logging each removal. An id that cannot be looked up stays: a network error
 * must not empty the list.
 */
export function pruneWatchList(config: AutomataConfig): number[] {
  const watch = normalizeWatch(config.conductor?.watch);
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

/** One watched item read into a thread, with the conversations the reply rule decides. */
interface WatchedItem {
  thread: ConductorThread;
  conversations: Conversation[];
}

function readPr(number: number): ThreadPr {
  return { surface: getPrSurface(number), checks: getPrChecks(number) };
}

/** A watched issue brings its open linked pull requests; a watched pull request stands alone. */
function readWatchedItem(id: number): WatchedItem {
  const target = getWatchTarget(id);
  if (target.kind === "pr") {
    const pr = readPr(id);
    return { thread: { kind: "pr", prs: [pr] }, conversations: [prConversation(pr.surface)] };
  }
  const issue = getIssueSurface(id);
  const prs = (getOpenPrLinkMap().byIssue.get(id) ?? []).map((ref) => readPr(ref.number));
  return {
    thread: { kind: "issue", issue, prs },
    conversations: [issueConversation(issue), ...prs.map((pr) => prConversation(pr.surface))],
  };
}

/** The current messages of the conversation a reply goes on. */
function readTargetMessages(target: ReplyTarget) {
  return target.kind === "issue"
    ? issueConversation(getIssueSurface(target.number)).messages
    : prConversation(getPrSurface(target.number)).messages;
}

/** Read-only: the conductor comments, nothing else. `--body-file -` is how it posts without writing a file. */
function runModel(prompt: string, execution: ConductorExecution, replyTo: ReplyTarget): Promise<void> {
  const { owner, repo } = getRepoSlug();
  return runClaude(prompt, { model: execution.model, effort: execution.effort, readOnly: true, replyTo, ghRepo: `${owner}/${repo}` });
}

/** A dry run: no comment permission, and the model's stdout is the reply, so it is captured. */
async function runModelForText(prompt: string, execution: ConductorExecution): Promise<string | null> {
  const { owner, repo } = getRepoSlug();
  let stdout = "";
  const sink = {
    output: (stream: "stdout" | "stderr", text: string) => {
      if (stream === "stdout") stdout += text;
    },
    exited: () => undefined,
  };
  const options = { model: execution.model, effort: execution.effort, readOnly: true, ghRepo: `${owner}/${repo}`, sink };
  if (execution.executor === "codex") await runCodex(prompt, { ...options, quiet: true });
  else await runClaude(prompt, options);
  return extractDryRunReply(execution.executor, stdout);
}

type ItemResult = "replied" | "idle" | "failed";

async function conductItem(
  id: number,
  config: AutomataConfig,
  login: string,
  participants: Participants,
  execution: ConductorExecution,
  dryRun = false,
): Promise<ItemResult> {
  const label = `#${String(id)}`;
  let item: WatchedItem;
  try {
    item = readWatchedItem(id);
  } catch (err) {
    // As in the prune: a network error is not the run's failure, and the next tick reads it again.
    process.stderr.write(`Warning: could not read ${label}, skipping it this tick: ${(err as Error).message}\n`);
    return "idle";
  }
  const { thread, conversations } = item;
  const verdict = decideConductorReply(conversations, participants);
  const owed = verdict.decisions.find((decision) => decision.kind === "reply");
  if (owed === undefined) {
    process.stdout.write(`Conductor: ${label} needs no reply.\n`);
    return "idle";
  }
  const replyTo: ReplyTarget = { kind: owed.surface.kind, number: owed.surface.number };
  const frame =
    thread.kind === "issue"
      ? (config.conductor?.prompts?.issue ?? DEFAULT_CONDUCTOR_ISSUE_PROMPT)
      : (config.conductor?.prompts?.pr ?? DEFAULT_CONDUCTOR_PR_PROMPT);
  const prompt = composeConductorPrompt({ thread, repo: getRepoSlug(), participants, frame, replyTo, dryRun });
  const where = `${replyTo.kind === "pr" ? "pull request" : "issue"} #${String(replyTo.number)}`;

  process.stdout.write(`Conductor: ${label} needs a reply on ${where}; running ${describeConductorExecution(execution)}.\n`);
  if (dryRun) {
    const reply = await runModelForText(prompt, execution);
    if (reply === null) {
      process.stderr.write(`Error: the dry run for ${label} produced no reply text.\n`);
      return "failed";
    }
    process.stdout.write(`--- Dry run: reply for ${where} (not posted) ---\n${reply}\n---\n`);
    return "replied";
  }
  const outcome = await conductReply({
    login,
    read: () => readTargetMessages(replyTo),
    run: () => runModel(prompt, execution, replyTo),
  });
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

export function runWatchRemove(rawId: string): number {
  const id = parseWatchId(rawId);
  if (id === null) return fail(`"${rawId}" is not an issue or pull request number.`);
  const before = normalizeWatch(readRawConfig().conductor?.watch);
  if (!before.includes(id)) return fail(`#${String(id)} is not on the watch list.`);
  updateWatch((current) => withoutWatched(current, id));
  process.stdout.write(`Stopped watching #${String(id)}.\n`);
  return 0;
}

export function runWatchList(): number {
  const config = loadGitHubConfig();
  if (typeof config === "number") return config;
  const watch = normalizeWatch(config.conductor?.watch);
  if (watch.length === 0) {
    process.stdout.write("The watch list is empty.\n");
    return 0;
  }
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
}

function staleMinutesOf(config: AutomataConfig): number {
  return config.doWork?.lockStaleMinutes ?? DEFAULT_DO_WORK.lockStaleMinutes;
}

/** Read one watched id the way a tick would, without changing anything. */
function checkWatched(id: number, participants: Participants): WatchedCheck {
  try {
    const target = getWatchTarget(id);
    if (isWatchClosed(target.state)) return { id, kind: target.kind, state: "closed", decisions: [] };
    const { conversations } = readWatchedItem(id);
    return { id, kind: target.kind, state: "open", decisions: decideConductorReply(conversations, participants).decisions };
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
  const report =
    "problem" in checked
      ? buildConductorCheck({
          generatedAt, repo, configProblem: checked.problem, identity: "", execution: "",
          lock: { kind: "free" }, staleMinutes: DEFAULT_DO_WORK.lockStaleMinutes, watched: [],
        })
      : buildConductorCheck({
          generatedAt, repo, configProblem: null,
          identity: checked.login,
          execution: describeConductorExecution(checked.execution),
          lock: inspectConductorLock(staleMinutesOf(checked.config)),
          staleMinutes: staleMinutesOf(checked.config),
          watched: normalizeWatch(checked.config.conductor?.watch).map((id) => checkWatched(id, checked.participants)),
        });
  process.stdout.write(report.text);
  return report.exitCode;
}

/** `--dry-run`: the tick without its effects. A live lock is a warning, not a stop, because nothing is written. */
async function runConductorDryRun(checked: Preflight): Promise<number> {
  const { config, login, participants, execution } = checked;
  // Codex has no command allow-list: its read-only sandbox still has network access, so a model could post.
  if (execution.executor === "codex") {
    return fail("--dry-run cannot be used with the codex executor: it cannot stop the model from posting.");
  }
  const lock = inspectConductorLock(staleMinutesOf(config));
  if (lock.kind === "held" || lock.kind === "suspect") {
    process.stderr.write(`Warning: a conductor is running here (pid ${String(lock.owner.pid)}); the dry run does not take the lock.\n`);
  }
  process.stdout.write(`Conductor: dry run as ${login}; nothing is posted and the watch list is not changed.\n`);
  let failed = 0;
  for (const id of normalizeWatch(config.conductor?.watch)) {
    try {
      if (isWatchClosed(getWatchTarget(id).state)) {
        process.stdout.write(`Conductor: #${String(id)} is closed; a tick would drop it from the watch list.\n`);
        continue;
      }
    } catch {
      // As in the prune: an id that cannot be looked up stays, and conductItem reports the read failure.
    }
    try {
      // One item at a time on purpose, as in a real tick.
      if ((await conductItem(id, config, login, participants, execution, true)) === "failed") failed++; // NOSONAR
    } catch (err) {
      process.stderr.write(`Error: #${String(id)} could not be conducted: ${(err as Error).message}\n`);
      failed++;
    }
  }
  return failed > 0 ? 1 : 0;
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
  if (options.check === true && options.dryRun === true) {
    return fail("--check and --dry-run cannot be used together.");
  }
  if (options.check === true) return runConductorCheck();
  const checked = preflight();
  if ("problem" in checked) return fail(checked.problem);
  if (options.dryRun === true) return runConductorDryRun(checked);
  const { config, login, participants, execution } = checked;
  const staleMinutes = config.doWork?.lockStaleMinutes ?? DEFAULT_DO_WORK.lockStaleMinutes;
  const lock = acquireConductorLock(staleMinutes);
  if (!lock.ok) {
    const held = lock.heldBy;
    process.stdout.write(
      `Another conductor is already running here (pid ${String(held.pid)} on ${held.host}, ` +
        `started ${held.startedAt}). Doing nothing.\n`,
    );
    if (lock.suspect) {
      process.stderr.write(
        `Warning: that lock has been held longer than ${String(staleMinutes)} minutes. If no tick is really ` +
          `running, its process id was probably reused; remove ${CONDUCTOR_LOCK_RELATIVE_PATH} once you have confirmed that.\n`,
      );
      return 2;
    }
    return 0;
  }

  try {
    process.stdout.write(`Conductor: running as ${login}.\n`);
    const watch = pruneWatchList(config);
    let failed = 0;
    for (const id of watch) {
      try {
        // One item at a time on purpose: each run reads and writes the same account's conversations.
        if ((await conductItem(id, config, login, participants, execution)) === "failed") failed++; // NOSONAR
      } catch (err) {
        process.stderr.write(`Error: #${String(id)} could not be conducted: ${(err as Error).message}\n`);
        failed++;
      }
    }
    return failed > 0 ? 1 : 0;
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
  .action(async (options: ConductorOptions) => {
    exitWith(await runConductor(options));
  });

conductorCommand
  .command("add <id>")
  .description("Watch an issue or pull request and make do-work pick it up (an issue also follows its linked PR)")
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
