import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Where full run transcripts live, relative to the repository root. */
export const RUN_TRANSCRIPT_DIR = ".automata/runs";

/** Lines of output kept for the excerpt in the fallback comment. */
export const EXCERPT_MAX_LINES = 20;
/** Bytes of excerpt allowed in the fallback comment. */
export const EXCERPT_MAX_BYTES = 4096;

/** What a runner reports to a transcript: every chunk it read, and how the child ended. */
export interface RunSink {
  output(stream: "stdout" | "stderr", text: string): void;
  exited(code: number | null, signal: string | null): void;
}

const PRIVATE_KEY_BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/g;
const PRIVATE_KEY_END = /-----END [A-Z ]*PRIVATE KEY-----/g;

const REDACTIONS: RegExp[] = [
  // An unterminated key is masked to the end of the text: its END line may not
  // have arrived yet, and nothing after a BEGIN line is safe to show.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bgithub_pat_\w{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bsk-[\w-]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g,
];

const AUTH_HEADER = /\b(Bearer|Basic)\s+[\w.~+/=-]{12,}/gi;
/** The name side of `NAME=value` / `name: value`, up to where the value starts. */
const SECRET_NAME = /\b\w*(?:token|secret|passw(?:or)?d|api[_-]?key)\w*\s*[=:]\s*/gi;
/** The value that follows a secret name: quoted, or up to whitespace, `,` or `;`. */
const SECRET_VALUE = /"[^"]*"|'[^']*'|[^\s,;]+/y;

/** Replace the value of every `*_TOKEN=…`, `password: …` style assignment. */
function redactAssignments(text: string): string {
  let out = "";
  let copied = 0;
  for (const match of text.matchAll(SECRET_NAME)) {
    // A name found inside a value already masked, as in `token=mytoken=x`.
    if (match.index < copied) continue;
    const valueStart = match.index + match[0].length;
    SECRET_VALUE.lastIndex = valueStart;
    const value = SECRET_VALUE.exec(text);
    if (value === null) continue;
    out += `${text.slice(copied, valueStart)}[redacted]`;
    copied = valueStart + value[0].length;
  }
  return out + text.slice(copied);
}

/**
 * Mask token-shaped strings before text is posted to a public thread. A
 * best-effort filter: it removes the shapes automata knows about, which is why
 * the excerpt is also size-capped and the full transcript is never posted.
 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of REDACTIONS) out = out.replace(pattern, "[redacted]");
  out = out.replace(AUTH_HEADER, "$1 [redacted]");
  return redactAssignments(out);
}

/** Whether `text` leaves a private key open: a BEGIN line after the last END line. */
function opensPrivateKey(text: string): boolean {
  const lastIndex = (pattern: RegExp): number => {
    let last = -1;
    for (const match of text.matchAll(pattern)) last = match.index;
    return last;
  };
  return lastIndex(PRIVATE_KEY_BEGIN) > lastIndex(PRIVATE_KEY_END);
}

/**
 * The human-readable part of one line of the model's `stream-json` output: the
 * text it wrote, the tools it called, or the final result. Any other line is
 * returned as it is, and a line that carries nothing worth showing is `null`.
 */
export function readableLine(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed === "") return null;
  let event: unknown;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
  if (typeof event !== "object" || event === null) return trimmed;
  const record = event as Record<string, unknown>;
  if (record["type"] === "result") {
    return typeof record["result"] === "string" ? `result: ${record["result"]}` : null;
  }
  return record["type"] === "assistant" ? assistantText(record["message"]) : null;
}

/** The text blocks and tool names of one assistant message, or null when it has none. */
function assistantText(message: unknown): string | null {
  const content = (message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content as Record<string, unknown>[]) {
    if (block["type"] === "text" && typeof block["text"] === "string") parts.push(block["text"]);
    if (block["type"] === "tool_use" && typeof block["name"] === "string") parts.push(`[tool: ${block["name"]}]`);
  }
  return parts.length === 0 ? null : parts.join(" ");
}

const ELLIPSIS = "…";

/** Keep the last `maxLines` lines and at most `maxBytes` bytes, dropping from the front. */
export function capExcerpt(text: string, maxLines = EXCERPT_MAX_LINES, maxBytes = EXCERPT_MAX_BYTES): string {
  let out = text.split("\n").slice(-maxLines).join("\n");
  if (Buffer.byteLength(out, "utf8") > maxBytes) {
    // The marker counts towards the cap, so the result never exceeds `maxBytes`.
    const keep = Math.max(maxBytes - Buffer.byteLength(ELLIPSIS, "utf8"), 0);
    const tail = keep === 0 ? "" : Buffer.from(out, "utf8").subarray(-keep).toString("utf8");
    out = `${ELLIPSIS}${tail.replace(/^\uFFFD+/, "")}`;
  }
  return out;
}

/**
 * The file-name label of a run, after the surface the turn works on: `pr-<n>`
 * for either pull-request turn, even when it also closes an issue.
 */
export function transcriptLabel(item: {
  turn: string;
  issue: { number: number } | null;
  pr: { number: number } | null;
}): string {
  if (item.turn !== "issue-discuss" && item.pr !== null) return `pr-${String(item.pr.number)}`;
  return `issue-${String(item.issue?.number ?? 0)}`;
}

/**
 * The full record of one agent run, written to `.automata/runs/` as it arrives,
 * plus a readable tail kept in memory for the fallback comment.
 *
 * The directory is created with a `.gitignore` of `*`, so a transcript never
 * shows up as an uncommitted change in a repository that has not ignored it.
 * The transcript is raw and unredacted, so the directory and the file are
 * private to the user running automata (0700 / 0600).
 */
export class RunTranscript implements RunSink {
  readonly fileName: string;
  readonly path: string;
  exitCode: number | null = null;
  signal: string | null = null;
  private readonly startedAt = Date.now();
  private endedAt: number | null = null;
  private readonly readable: string[] = [];
  private pending = { stdout: "", stderr: "" };
  private writable = true;
  /** Whether the next stderr byte written to the file starts a line. */
  private stderrAtLineStart = true;
  /** A private key began in an earlier line and has not ended yet. */
  private inPrivateKey = false;

  constructor(label: string, root: string = process.cwd(), now: Date = new Date()) {
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    this.fileName = `${stamp}-${label}.log`;
    const dir = join(root, RUN_TRANSCRIPT_DIR);
    this.path = join(dir, this.fileName);
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeIfAbsent(join(dir, ".gitignore"), "*\n");
      // `wx`: never append to, or follow a link to, a file that is already there.
      writeFileSync(this.path, "", { flag: "wx", mode: 0o600 });
    } catch {
      this.writable = false;
    }
  }

  /** False when the file could not be created; the excerpt still works. */
  get saved(): boolean {
    return this.writable;
  }

  output(stream: "stdout" | "stderr", text: string): void {
    if (this.writable) {
      try {
        appendFileSync(this.path, stream === "stderr" ? this.prefixStderr(text) : text);
      } catch {
        this.writable = false;
      }
    }
    const buffered = this.pending[stream] + text;
    const lines = buffered.split("\n");
    this.pending[stream] = lines.pop() ?? "";
    for (const line of lines) this.keep(stream, line);
  }

  exited(code: number | null, signal: string | null): void {
    this.exitCode = code;
    this.signal = signal;
    this.endedAt = Date.now();
    for (const stream of ["stdout", "stderr"] as const) {
      if (this.pending[stream] !== "") this.keep(stream, this.pending[stream]);
      this.pending[stream] = "";
    }
  }

  get durationMs(): number {
    return (this.endedAt ?? Date.now()) - this.startedAt;
  }

  /**
   * The redacted, capped tail of what the agent said and printed. Redacted
   * before it is cut, so a cut never leaves half a token that no longer
   * matches a pattern.
   */
  excerpt(): string {
    return capExcerpt(redactSecrets(this.readable.join("\n")));
  }

  /**
   * Every line is redacted as it is kept, and a private key that spans lines is
   * masked until its END line, even when its BEGIN line has since dropped out
   * of the kept tail.
   */
  private keep(stream: "stdout" | "stderr", line: string): void {
    const shown = stream === "stderr" ? line.trim() : readableLine(line);
    if (shown === null || shown === "") return;
    const continuing = this.inPrivateKey;
    const scanned = continuing ? `-----BEGIN PRIVATE KEY-----\n${shown}` : shown;
    this.inPrivateKey = opensPrivateKey(scanned);
    const redacted = redactSecrets(scanned);
    // The BEGIN line already showed `[redacted]`; one per key is enough.
    if (continuing && redacted === "[redacted]") return;
    this.readable.push(redacted);
    if (this.readable.length > EXCERPT_MAX_LINES * 4) this.readable.splice(0, this.readable.length - EXCERPT_MAX_LINES * 4);
  }

  /**
   * Mark each stderr line in the file. Chunks split lines anywhere, so the
   * prefix goes only where a line actually starts.
   */
  private prefixStderr(text: string): string {
    let out = "";
    for (const piece of text.split(/(?<=\n)/)) {
      if (this.stderrAtLineStart) out += STDERR_PREFIX;
      out += piece;
      this.stderrAtLineStart = piece.endsWith("\n");
    }
    return out;
  }
}

const STDERR_PREFIX = "[stderr] ";

/** Create `path` with `content` unless something is already there. */
function writeIfAbsent(path: string, content: string): void {
  try {
    writeFileSync(path, content, { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
}

/** What changed in the checkout while the agent ran. */
export interface RunSideEffects {
  branchBefore: string | null;
  branchAfter: string | null;
  headBefore: string | null;
  headAfter: string | null;
  /** Pull request of the branch the run ended on, when it moved onto a new one. */
  pr: { number: number; url: string } | null;
}

export interface RunDiagnosticsInput {
  turn: string;
  subject: string;
  transcript: RunTranscript;
  effects: RunSideEffects | null;
}

function describeEffects(effects: RunSideEffects | null): string {
  if (effects === null) return "could not be determined";
  const notes: string[] = [];
  if (effects.branchAfter !== null && effects.branchAfter !== effects.branchBefore) {
    notes.push(`branch \`${effects.branchAfter}\` was created or checked out`);
  }
  if (effects.pr !== null) notes.push(`pull request #${String(effects.pr.number)} exists for it (${effects.pr.url})`);
  if (effects.headBefore !== null && effects.headAfter !== null && effects.headBefore !== effects.headAfter) {
    notes.push("the checked-out branch gained commits");
  }
  return notes.length === 0 ? "no new branch, pull request or commit was detected" : notes.join("; ");
}

/**
 * The diagnostics block appended to the "no answer" comment. Names the
 * transcript by file name only: its path and contents stay on the machine.
 */
export function renderRunDiagnostics(input: RunDiagnosticsInput): string {
  const { transcript } = input;
  const exitCode = transcript.exitCode === null ? "unknown" : String(transcript.exitCode);
  const ended = transcript.signal === null ? `exit code ${exitCode}` : `terminated on ${transcript.signal}`;
  const lines = [
    `- Turn: \`${input.turn}\` on ${input.subject}`,
    `- Agent: ${ended}, ran for ${formatDuration(transcript.durationMs)}`,
    `- Changes in the checkout: ${describeEffects(input.effects)}`,
  ];
  if (transcript.saved) lines.push(`- Full transcript on the machine that ran automata: \`${transcript.fileName}\``);
  const excerpt = transcript.excerpt();
  const details =
    excerpt === ""
      ? ""
      : `\n\n<details>\n<summary>Last lines of the agent's output</summary>\n\n\`\`\`text\n${excerpt.replaceAll("```", "'''")}\n\`\`\`\n\n</details>`;
  return `\n\n${lines.join("\n")}${details}`;
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}m ${String(seconds % 60)}s`;
}
