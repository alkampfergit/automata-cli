# Research: Check Issue For New Messages

## Decision 1: Detect "new message since last execution" from the agent's own last comment

**Decision**: Use the timestamp of the most recent issue **comment authored by the configured agent account** as the last-execution boundary. A new message exists when at least one comment from an allowed user is strictly newer than that boundary. The command posts a short marker comment as the agent account before invoking the AI, so the boundary always advances even when the AI itself never comments.

**Rationale**: The boundary lives in the same place as the data it describes, so it survives across machines, containers, CI runners and repository clones — which is exactly how this command is expected to be run (polling loops, automation). The agent account must already be configured in order to filter the conversation, so no extra configuration is introduced. The repository already uses this idiom: `implement-next` posts a claim comment on the issue before invoking the AI.

**Alternatives considered**:

- **Local state file** (e.g. `.automata/issue-state.json` mapping issue number → last-seen comment id). Rejected: invisible to other participants, lost in ephemeral CI environments, and would desynchronise whenever the same issue is processed from a second checkout.
- **A reaction (e.g. 👀) on the newest comment**. Rejected: reactions are not timestamped in a usable way through `gh issue view`, are easy for a human to remove by accident, and communicate nothing to the maintainers reading the thread.
- **A hidden HTML-comment marker inside the agent's comment body**. Rejected: the comment *author* is already an unambiguous signal, and body parsing would break the moment a maintainer edits or quotes the marker.
- **GitHub issue `updatedAt`**. Rejected: it changes on labels, assignments and edits, so it cannot distinguish a maintainer message from unrelated churn.

## Decision 2: Expose the feature as an `execute-prompt` subcommand

**Decision**: Add `automata execute-prompt check-issue <issue-number>` rather than a new top-level command.

**Rationale**: The command has exactly the shape of the existing `execute-prompt` subcommands — gather context from the remote, compose a configured prompt, invoke Claude or Codex — and can reuse the normalized `--with` / `--model` / `--silent` / `--push` contract introduced by feature 028. A new top-level command would duplicate that option surface and split a coherent command group.

**Alternatives considered**:

- **Top-level `automata check-issue`**. Rejected: it would need its own copy of the executor option plumbing, and the `execute-prompt` group description ("execute a configured custom prompt using an AI assistant") already describes this command precisely.
- **A flag on `implement-next`**. Rejected: `implement-next` discovers an issue from a filter and claims it; this command targets a known issue and reacts to conversation. Combining them would violate the constitution's single-responsibility principle.

## Decision 3: Filter the conversation uniformly, including the issue body

**Decision**: Include a message in the prompt only when its author is an allowed user or the agent account. This filter applies to the issue description as well as to the comments. The issue number, title and URL are always included so the AI can identify — and if necessary read — the issue itself.

**Rationale**: The request is explicit that the conversation passed to the prompt contains "only messages of the allowed user and the agent". Applying the filter uniformly also closes the obvious injection path: text written by an arbitrary GitHub user never reaches the agent's prompt as if it were an instruction.

**Alternatives considered**:

- **Always include the issue body regardless of author**. Rejected: on a public repository, anyone can open an issue, so the body is untrusted input; including it unconditionally would let a stranger write the agent's instructions.
- **Include non-allowed messages, marked as untrusted**. Rejected as scope creep and as an unreliable safety boundary — prompt-level labelling is not a permission system.

## Decision 4: Agent messages never count as new messages

**Decision**: A comment authored by the agent account is never counted as a new message, even if the agent account also appears in the allowed-user list.

**Rationale**: Without this rule, the marker comment the command posts would itself qualify as a new message on the next run, so every invocation would trigger another one — an unbounded loop that costs money. Making the rule explicit means a misconfiguration (agent listed among allowed users) is harmless rather than catastrophic.

**Alternatives considered**:

- **Reject the configuration when the agent appears in `allowedUsers`**. Rejected: a hard failure is a worse experience than simply doing the safe thing, and the agent's own messages legitimately belong in the conversation.

## Decision 5: Timestamp comparison and tie-breaking

**Decision**: Compare ISO-8601 UTC timestamps (`createdAt`) as strings, and require the allowed-user message to be **strictly** newer than the last agent comment.

**Rationale**: `gh` returns `createdAt` as normalised `YYYY-MM-DDTHH:MM:SSZ`, for which lexicographic and chronological order coincide; this avoids date parsing entirely. Requiring strict inequality means an exact-tie timestamp resolves to "no new message", so the failure mode of a tie is a skipped run that `--force` can recover, not a run loop.

**Alternatives considered**:

- **Compare comment ids**. Rejected: `gh` returns opaque base64-ish node ids (`IC_kwDO…`) that are not ordered.
- **Parse to `Date` and compare epoch milliseconds**. Rejected: same result, more code, and it would silently produce `NaN` comparisons if a timestamp were ever malformed.

## Decision 6: "No new message" is a success

**Decision**: Exit 0 with an explanatory message on stdout when there is nothing to do, and post no comment.

**Rationale**: The command is designed to be run repeatedly (a polling loop, a scheduled job). If "nothing happened" were a non-zero exit, every wrapper script would need to special-case it. The constitution requires meaningful exit codes, and "checked successfully, no action required" is a success.

**Alternatives considered**:

- **Exit with a distinct non-zero code (e.g. 2) for "no new message"**. Rejected: no caller in this repository consumes granular exit codes, and it would make `set -e` loops fail on the normal case.

## Decision 7: Only an explicit Azure DevOps remote is rejected

**Decision**: Fail with the `docs/azdo-gap.md` pointer when `remoteType` is `azdo`; treat an absent `remoteType` as GitHub.

**Rationale**: The two settings that actually gate this command are `allowedUsers` and `agentUser`, and both are validated with actionable errors. Demanding a third setting that most users never explicitly write would add friction with no safety benefit, and the underlying `gh` calls already fail with a clear message outside a GitHub repository.

**Alternatives considered**:

- **Require `remoteType === "gh"`, as `implement-next` does**. Rejected for the friction above; `implement-next` needs the value because its whole discovery behaviour is remote-specific, whereas this command takes an explicit issue number.

## Decision 8: Marker-comment failure aborts the run

**Decision**: If posting the marker comment fails, exit 1 without invoking the AI.

**Rationale**: The marker *is* the persisted state. Running the AI without it would leave the boundary unchanged, so the same message would start a fresh agent run on every subsequent invocation. Failing loudly and early is the only outcome that cannot silently burn tokens.

**Alternatives considered**:

- **Warn and continue** (the pattern `implement-next` uses for its post-run PR updates). Rejected: those warnings are cosmetic follow-ups, whereas here the comment carries the deduplication guarantee.

## Autonomous Decisions

- Chose the agent's last comment as the execution boundary (Decision 1) because the request asked to "find a good way" without prescribing one, and this is the only option that is both stateless and visible to the humans on the thread.
- Chose to place the pure conversation logic in its own module (`src/github/issueConversation.ts`) so detection and filtering are unit-testable without mocking the `gh` CLI, while the `gh` call itself joins the existing GitHub wrappers in `src/config/githubService.ts` and reuses their `spawnSync` helper.
- Chose to expose the two new configuration keys through both `automata config set` and the interactive wizard, because every existing key is reachable both ways.
