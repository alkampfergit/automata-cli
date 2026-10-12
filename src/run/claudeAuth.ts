/**
 * Patterns that show Claude Code stopped because its login is no longer valid.
 * Add a pattern here to teach `do-work` a new wording; nothing else must change.
 */
export const CLAUDE_AUTH_PATTERNS: readonly RegExp[] = [
  /Failed to authenticate/i,
  /OAuth (?:session|token) (?:has )?expired/i,
  /Invalid API key\s*[·\-:]\s*Please run \/login/i,
  /Please run \/login/i,
];

/** The marker text in a comment that tells the user about a Claude login failure. */
export const CLAUDE_AUTH_MARKER = "<!-- automata:claude-auth -->";

/** True when `text` (Claude output) shows an authentication failure. */
export function detectClaudeAuthFailure(text: string): boolean {
  return CLAUDE_AUTH_PATTERNS.some((pattern) => pattern.test(text));
}

/** The reason shown for a blocked tick, in the report and in the comment. */
export const CLAUDE_AUTH_REASON =
  "Claude Code is not signed in (its login expired and could not be refreshed)";

/** What the user must do. */
export const CLAUDE_AUTH_REMEDY =
  "Run `claude /login` again on the machine that runs automata (inside the devcontainer, if it runs there), then reply to have another attempt made.";

/** The comment body for a run that stopped because of a Claude login failure. */
export function renderClaudeAuthComment(surface: string, excerpt: string): string {
  const lines = [
    `automata do-work: the agent run stopped before it posted an answer on ${surface}. ${CLAUDE_AUTH_REASON}.`,
    CLAUDE_AUTH_REMEDY,
    "This comment is posted once. Automata does not post it again while the problem remains.",
  ];
  if (excerpt.trim() !== "") {
    lines.push("", "Last lines of the agent's output:", "```text", excerpt.replaceAll("```", "'''"), "```");
  }
  return `${lines.join("\n")}\n${CLAUDE_AUTH_MARKER}`;
}
