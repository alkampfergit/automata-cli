/**
 * Whether the account `gh` is authenticated as can drive the loop.
 *
 * Pure, and separate from the `gh` call that produces the login, so both the
 * tick (which refuses to run on a mismatch) and `do-work --check` (which reports
 * it) reach the same verdict from one query instead of each making their own.
 */
export function identityProblemFor(
  login: string | null,
  agentUser: string,
  allowedUsers: string[],
): string | null {
  // Unverifiable is not a mismatch: an app installation token has no user, and
  // refusing on that would stop a correctly configured loop.
  if (login === null) return null;

  if (login.toLowerCase() === agentUser.toLowerCase()) return null;

  if (allowedUsers.some((user) => user.toLowerCase() === login.toLowerCase())) {
    return (
      `\`gh\` is authenticated as "${login}", which is listed in allowedUsers. ` +
      `Everything do-work posts would be attributed to an account that is allowed to instruct the agent, ` +
      `so its own marker comment would look like a new instruction and each tick would answer the previous tick forever. ` +
      `Authenticate \`gh\` as the agent account (${agentUser}) in this environment, or correct \`agentUser\`.`
    );
  }

  // Any known mismatch is fatal, not just an authorized one. The marker would be
  // posted by an account that is neither the agent nor authorized, so the
  // conversation filter drops it entirely: the boundary never advances and the
  // same human message starts a model run on every tick. Only the unverifiable
  // case above is allowed to proceed.
  return (
    `\`gh\` is authenticated as "${login}" but agentUser is "${agentUser}". ` +
    "Comments posted under that identity are neither the agent's nor an authorized user's, so they are " +
    "filtered out of the conversation: the answer boundary would never advance and the same message would " +
    "start a run on every tick. " +
    `Authenticate \`gh\` as the agent account (${agentUser}) in this environment, or correct \`agentUser\`.`
  );
}
