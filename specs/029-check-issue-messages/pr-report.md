# PR Report: Check Issue For New Messages

**Branch**: `feature/029-check-issue-messages`
**Date**: 2026-09-09
**Spec**: [specs/029-check-issue-messages/spec.md](../../specs/029-check-issue-messages/spec.md)

## Summary

Adds `automata execute-prompt check-issue <issue-number>`, which reads a GitHub issue and decides whether one of the configured allowed users has posted a message since the agent's own last run. When one has — or when `--force` is passed — it posts a short marker comment as the agent account and launches Claude or Codex with a configurable prompt containing the issue number, title, URL and the conversation filtered down to the allowed users and the agent. This turns a maintainer's reply on an issue into an agent run without anyone having to read the thread, and it is safe to invoke repeatedly because the boundary between "already handled" and "new" is stored on the issue itself rather than in local state.

## What's New

- **`execute-prompt check-issue` subcommand** (`src/commands/executePrompt.ts`): takes a required issue number, reuses the shared `--with` / `--model` / `--silent` / `--push` option contract from feature 028, and adds `--force` to skip the new-message check. Validates the executor, the issue number, the remote type and the two new configuration keys before touching the network.
- **New-message detection** (`src/github/issueConversation.ts`): a pure, I/O-free module that takes the issue conversation and returns the participant-filtered message list plus the new-message verdict. The last-execution boundary is the newest comment authored by `agentUser`, so no local state file is needed and the command behaves identically from any machine or CI runner. Agent messages never count as new, which is what stops the command from retriggering on its own marker comment.
- **Conversation retrieval** (`src/config/githubService.ts`): `getIssueConversation()` runs `gh issue view --json number,title,body,url,author,createdAt,comments`, flattens author logins to strings and sorts comments oldest-first, reusing the module's existing `spawnSync` runner.
- **Marker comment as the run record**: the command posts `automata check-issue: …` on the issue as the agent account *before* invoking the AI, and aborts with exit 1 if that comment cannot be posted — running the AI without it would restart a fresh run on every later invocation.
- **Configuration keys** (`src/config/configStore.ts`): `allowedUsers` (logins allowed to instruct the agent) and `agentUser` (the login the agent posts as), plus the configurable `prompts.checkIssue` with a built-in `DEFAULT_CHECK_ISSUE_PROMPT`. The new prompt resolves `.md` file references through the existing `resolvePromptRef()`, exactly like the other prompts.
- **Non-interactive configuration** (`src/commands/config.ts`): `automata config set allowed-users alice,bob` (trims entries, drops empties, rejects an all-empty value) and `automata config set agent-user agent-bot`.
- **Interactive configuration** (`src/config/ConfigWizard.tsx`): a new `Issue Watch` main-menu entry with allowed-users and agent-user screens, and a `Prompts → Check-Issue` screen that writes `.automata/check-issue-prompt.md`. Both entries are appended last, so existing menu positions are unchanged.
- **Documentation**: a full `check-issue` reference in `docs/execute-prompt.md` (options, detection rules, conversation format, prompt configuration, exit codes), the new keys and a wizard menu map in `docs/config.md`, and one example line in `README.md`.

## Breaking Changes

None. The two existing `execute-prompt` subcommands, their options and their prompt payloads are untouched, and both new configuration keys are optional — only `check-issue` reads them.

## Testing

- **Unit — detection logic** (`tests/unit/issueConversation.test.ts`, 15 tests): boundary taken from the newest agent comment; no-new-message when the agent spoke last; multiple new messages counted; first execution with and without an allowed issue author; the issue description not acting as a boundary when the agent opened the issue; agent messages never new even when the agent is also listed as allowed; non-allowed authors excluded from both detection and output; case-insensitive login matching; an exactly-equal timestamp treated as not new; chronological ordering; empty allowed-user list; and the rendered format including the `NEW since last agent run` marker.
- **Unit — command wiring** (`tests/unit/executePromptCheckIssue.cmd.test.ts`, 23 tests): prompt contents (issue number, title, URL, filtered conversation, custom vs default prompt); marker comment posted *before* the AI, asserted on call order; no-new-message exiting 0 with nothing posted and nothing invoked; `--force` on both the invocation and the marker text; missing/empty `allowedUsers`; missing `agentUser`; `azdo` rejection; absent `remoteType` accepted; invalid, zero and non-numeric issue numbers; invalid executor; unreadable issue; marker-comment failure aborting before invocation; and executor selection, `yolo`, `--model`, `--silent` and `--push` forwarding.
- **Unit — configuration** (`tests/unit/config.cmd.test.ts`, `tests/unit/configStore.test.ts`): the two new `config set` subcommands end-to-end against the built CLI (parsing, trimming, empty rejection, preserving existing keys) and round-tripping plus `.md` reference resolution for the new fields.
- **Unit — wizard** (`tests/unit/ConfigWizard.test.tsx`): navigation to and saving from the `Issue Watch` screens and the `Prompts → Check-Issue` screen, including the written filename and the `undefined`-instead-of-empty behaviour.
- **Manual** — ran the built CLI against real issue #34 with `allowedUsers: ["alkampfergit"]` / `agentUser: "alkampferoutlook"`, exercising the real `gh issue view` call, parsing and detection. It reported `No new messages from allowed users on issue #34 (last agent message: 2026-09-09T06:32:54Z)` and exited 0 without posting anything, as intended.
- **Suite**: `npm test` — 330 tests across 17 files, all passing. `npm run lint` clean, `tsc --noEmit` clean. `npx prettier --check src/` still reports the same 12 pre-existing files as `develop` does; the new module is Prettier-clean, so no formatting debt was added.

## Notes

- This repository's own tracked `.automata/config.json` was deliberately left unchanged. `check-issue` will exit 1 with an actionable message until `allowedUsers` and `agentUser` are set here — configuring who may command the agent in this repo is the owner's call, not this PR's.
- `agentUser` should be the account `gh` is authenticated as, since that is who the marker comment is posted by. A mismatch means the boundary never advances and every run reprocesses the same message; this is documented in `docs/config.md`.
- Two allowed-user messages arriving after the boundary start a single run that sees both, rather than one run per message.
- The command is deliberately single-issue: filter-based discovery already exists as `implement-next`, so no discovery or batching was added here.
