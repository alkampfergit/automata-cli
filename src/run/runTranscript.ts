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

const REDACTIONS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];

/**
 * Mask token-shaped strings before text is posted to a public thread. A
 * best-effort filter: it removes the shapes automata knows about, which is why
 * the excerpt is also size-capped and the full transcript is never posted.
 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of REDACTIONS) out = out.replace(pattern, "[redacted]");
  out = out.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, "$1 [redacted]");
  out = out.replace(
    /\b([A-Za-z0-9_]*(?:token|secret|password|passwd|api[_-]?key)[A-Za-z0-9_]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
    "$1$2[redacted]",
  );
  return out;
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
  if (record["type"] !== "assistant") return null;
  const message = record["message"] as { content?: unknown } | undefined;
  if (!Array.isArray(message?.content)) return null;
  const parts: string[] = [];
  for (const block of message.content as Record<string, unknown>[]) {
    if (block["type"] === "text" && typeof block["text"] === "string") parts.push(block["text"]);
    if (block["type"] === "tool_use" && typeof block["name"] === "string") parts.push(`[tool: ${block["name"]}]`);
  }
  return parts.length === 0 ? null : parts.join(" ");
}

/** Keep the last `maxLines` lines and at most `maxBytes` bytes, dropping from the front. */
export function capExcerpt(text: string, maxLines = EXCERPT_MAX_LINES, maxBytes = EXCERPT_MAX_BYTES): string {
  let out = text.split("\n").slice(-maxLines).join("\n");
  if (Buffer.byteLength(out, "utf8") > maxBytes) {
    out = Buffer.from(out, "utf8").subarray(-maxBytes).toString("utf8").replace(/^�+/, "");
    out = `…${out}`;
  }
  return out;
}

/**
 * The full record of one agent run, written to `.automata/runs/` as it arrives,
 * plus a readable tail kept in memory for the fallback comment.
 *
 * The directory is created with a `.gitignore` of `*`, so a transcript never
 * shows up as an uncommitted change in a repository that has not ignored it.
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

  constructor(label: string, root: string = process.cwd(), now: Date = new Date()) {
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    this.fileName = `${stamp}-${label}.log`;
    const dir = join(root, RUN_TRANSCRIPT_DIR);
    this.path = join(dir, this.fileName);
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, ".gitignore"), "*\n");
      writeFileSync(this.path, "");
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
        appendFileSync(this.path, stream === "stderr" ? prefixLines(text, "[stderr] ") : text);
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

  /** The redacted, capped tail of what the agent said and printed. */
  excerpt(): string {
    return redactSecrets(capExcerpt(this.readable.join("\n")));
  }

  private keep(stream: "stdout" | "stderr", line: string): void {
    const shown = stream === "stderr" ? line.trim() : readableLine(line);
    if (shown === null || shown === "") return;
    this.readable.push(shown);
    if (this.readable.length > EXCERPT_MAX_LINES * 4) this.readable.splice(0, this.readable.length - EXCERPT_MAX_LINES * 4);
  }
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line, i, all) => (line === "" && i === all.length - 1 ? line : `${prefix}${line}`))
    .join("\n");
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
  const ended =
    transcript.signal !== null
      ? `terminated on ${transcript.signal}`
      : `exit code ${transcript.exitCode === null ? "unknown" : String(transcript.exitCode)}`;
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
      : `\n\n<details>\n<summary>Last lines of the agent's output</summary>\n\n\`\`\`text\n${excerpt.replace(/```/g, "'''")}\n\`\`\`\n\n</details>`;
  return `\n\n${lines.join("\n")}${details}`;
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}m ${String(seconds % 60)}s`;
}
