/**
 * The tool calls Claude Code refused during a run.
 *
 * In `dontAsk` mode a call outside the allow-list is denied without a prompt, and the
 * model then reports only its own summary of why. The stream-json `result` event
 * lists each denial exactly, so `conductor --verbose` can print the command that
 * was refused. Pure: the caller collects the stdout text.
 */

export interface PermissionDenial {
  tool: string;
  /** The command for a Bash call, the file path for a file tool, else the input as JSON. */
  target: string;
}

const MAX_TARGET_LENGTH = 300;

function targetOf(input: unknown): string {
  if (typeof input !== "object" || input === null) return "";
  const record = input as Record<string, unknown>;
  for (const key of ["command", "file_path", "path", "pattern"]) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return JSON.stringify(input);
}

function denialOf(entry: unknown): PermissionDenial | null {
  if (typeof entry !== "object" || entry === null) return null;
  const record = entry as Record<string, unknown>;
  const tool = record["tool_name"];
  if (typeof tool !== "string") return null;
  return { tool, target: targetOf(record["tool_input"]) };
}

/** Every denial in the `result` events of a Claude stream-json stdout, oldest first. */
export function parsePermissionDenials(stdout: string): PermissionDenial[] {
  const denials: PermissionDenial[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const listed = event["type"] === "result" ? event["permission_denials"] : undefined;
      if (!Array.isArray(listed)) continue;
      for (const entry of listed) {
        const denial = denialOf(entry);
        if (denial !== null) denials.push(denial);
      }
    } catch {
      // not JSON: skip, as the live run does
    }
  }
  return denials;
}

/** One line per denial, with a long command cut and its line breaks flattened. */
export function describePermissionDenials(denials: readonly PermissionDenial[]): string[] {
  return denials.map((denial) => {
    // The target comes from the model: drop terminal control characters (ESC, BEL, ...) before it is printed.
    const flat = `${denial.tool} ${denial.target}`
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return flat.length <= MAX_TARGET_LENGTH ? flat : `${flat.slice(0, MAX_TARGET_LENGTH)}…`;
  });
}
