# Implementation Plan: Check Issue For New Messages

**Branch**: `feature/029-check-issue-messages` | **Date**: 2026-09-09 | **Spec**: `specs/029-check-issue-messages/spec.md`

**Input**: Feature specification from `specs/029-check-issue-messages/spec.md`

## Summary

Add `automata execute-prompt check-issue <issue-number>`, which reads a GitHub issue, decides whether an allowed user has posted a message since the agent's last run, and — when one exists, or when `--force` is given — posts an execution marker comment and invokes Claude or Codex with a configurable prompt containing the issue number, title, URL and the conversation filtered to allowed users and the agent. Two new configuration keys (`allowedUsers`, `agentUser`) and one new configurable prompt (`prompts.checkIssue`) back the behaviour.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode), Node.js LTS 18+

**Primary Dependencies**: commander.js, `gh` CLI via `node:child_process` `spawnSync`, ink + react (existing wizard), vitest

**Storage**: `.automata/config.json` (extended with `allowedUsers`, `agentUser`, `prompts.checkIssue`); `.automata/check-issue-prompt.md` when the wizard writes the prompt. No new persistent state — the execution boundary lives on the GitHub issue itself.

**Testing**: vitest unit tests

**Target Platform**: Node.js CLI

**Project Type**: CLI tool

**Performance Goals**: N/A — one `gh issue view` call plus at most one `gh issue comment` call per invocation

**Constraints**: No new runtime dependencies; reuse the normalized executor options from feature 028; existing `execute-prompt` subcommands must keep working unchanged

**Scale/Scope**: One new subcommand, one new pure module, one new `gh` wrapper, two config keys, one configurable prompt, wizard screens, docs and unit tests

## Constitution Check

- ✅ **CLI-First**: delivered as a commander.js subcommand with explicit argument and option definitions; errors to stderr, human-readable progress to stdout, meaningful exit codes (0 = handled or nothing to do, 1 = misconfiguration / GitHub failure / AI failure).
- ✅ **TypeScript Strictness**: no `any`; the `gh` JSON payload is parsed into an explicit raw shape and normalised into exported interfaces before use.
- ✅ **Single Responsibility**: the subcommand orchestrates only; conversation analysis and formatting live in a pure module, the `gh` call lives with the other GitHub wrappers, and AI invocation reuses the existing Claude/Codex services.
- ✅ **npm Distribution**: no new dependencies, no build changes.
- ✅ **Simplicity**: detection needs no new storage format; the boundary is derived from data the command already fetches.
- ⚠️ **Configuration via env/flags**: principle V prefers flags over configuration files, but `allowedUsers` and `agentUser` are per-repository trust settings that must not be retyped on every invocation, and `.automata/config.json` is the established home for exactly this kind of setting (`issueDiscoveryValue`, `claudeSystemPrompt`). The request also states the values belong in configuration. Recorded in Complexity Tracking.
- ✅ **Development Workflow**: `npm test && npm run lint` gate before completion; `README.md` and the `docs/` group page updated per the documentation convention.

## Project Structure

### Documentation (this feature)

```text
specs/029-check-issue-messages/
├── spec.md
├── research.md
├── plan.md
├── tasks.md
├── pr-report.md
├── spec-decisions.md
└── checklists/
    └── requirements.md
```

### Source Code Changes

```text
src/
├── commands/
│   ├── executePrompt.ts        # new `check-issue` subcommand + orchestration
│   └── config.ts               # `config set allowed-users`, `config set agent-user`
├── config/
│   ├── configStore.ts          # allowedUsers, agentUser, prompts.checkIssue, DEFAULT_CHECK_ISSUE_PROMPT
│   ├── githubService.ts        # getIssueConversation() via `gh issue view`
│   └── ConfigWizard.tsx        # "Issue Watch" screens + Prompts → Check-Issue
└── github/
    └── issueConversation.ts    # NEW: pure analysis + formatting (no I/O)

docs/
├── config.md                   # new keys, wizard mapping, prompt file reference
└── execute-prompt.md           # `check-issue` reference section

tests/
└── unit/
    ├── issueConversation.test.ts            # NEW: pure detection/filtering logic
    ├── executePromptCheckIssue.cmd.test.ts  # NEW: command wiring
    ├── config.cmd.test.ts                   # new `config set` subcommands
    └── ConfigWizard.test.tsx                # new wizard screens

README.md                       # one example line under `automata execute-prompt`
```

**Structure Decision**: Keep the existing single-project CLI layout. The `gh`-facing call joins the other GitHub wrappers in `src/config/githubService.ts` so it can reuse their private `spawnSync` runner, while the pure, I/O-free conversation logic gets its own domain directory `src/github/` — matching the existing one-directory-per-domain convention (`src/claude/`, `src/codex/`, `src/git/`) and making detection testable without mocking the `gh` CLI. `src/index.ts` is untouched, because `check-issue` attaches to the already-registered `execute-prompt` group.

## Implementation Design

### Configuration model (`src/config/configStore.ts`)

```ts
export interface AutomataPrompts {
  sonar?: string;
  fixComments?: string;
  checkIssue?: string;
}

export interface AutomataConfig {
  // …existing fields
  allowedUsers?: string[];
  agentUser?: string;
  prompts?: AutomataPrompts;
}

export const DEFAULT_CHECK_ISSUE_PROMPT = /* built-in instruction text */;
```

`readConfig()` resolves `prompts.checkIssue` through the existing `resolvePromptRef()`, so `.md` file references work exactly as they do for the other prompts.

### GitHub access (`src/config/githubService.ts`)

```ts
export interface IssueComment  { id: string; author: string; body: string; createdAt: string }
export interface IssueConversation {
  number: number; title: string; body: string; url: string;
  author: string; createdAt: string; comments: IssueComment[];
}

export function getIssueConversation(issueNumber: number): IssueConversation;
```

Runs `gh issue view <n> --json number,title,body,url,author,createdAt,comments`, flattens `author.login` to a string, sorts comments ascending by `createdAt`, and throws the `gh` stderr on non-zero status. Comment posting reuses the existing `postComment()`.

### Conversation analysis (`src/github/issueConversation.ts`, pure)

```ts
export interface ConversationMessage {
  kind: "issue" | "comment";
  author: string;
  body: string;
  createdAt: string;
  isNew: boolean;
}

export interface ConversationAnalysis {
  messages: ConversationMessage[];   // allowed + agent only, chronological
  newMessageCount: number;
  hasNewMessage: boolean;
  lastAgentAt: string | null;
}

export function analyzeConversation(
  conversation: IssueConversation,
  allowedUsers: string[],
  agentUser: string,
): ConversationAnalysis;

export function formatConversation(messages: ConversationMessage[]): string;
```

Algorithm:

1. Lower-case `agentUser` and every entry of `allowedUsers` for comparison.
2. `lastAgentAt` = greatest `createdAt` among **comments** whose author is the agent (the issue body never acts as a boundary, so an issue opened by the agent still processes normally).
3. Build the entry list: the issue description first, then the comments in ascending `createdAt` order.
4. An entry `isNew` when its author is allowed, its author is **not** the agent, and either `lastAgentAt` is `null` or `entry.createdAt > lastAgentAt`.
5. `messages` keeps entries whose author is allowed **or** the agent; everything else is dropped.
6. `formatConversation` renders each message as
   `[author] issue description|comment · <createdAt>[ · NEW since last agent run]` followed by the body, joined by blank lines — the same shape as the existing `formatComments` helper.

### Command orchestration (`src/commands/executePrompt.ts`)

`check-issue` is registered with the shared `addAiOptions()` helper plus `--force`, and takes a required `<issue-number>` argument:

1. Validate the executor via the existing `resolveExecutor()`.
2. Parse the issue number; reject non-positive integers with exit 1.
3. Read config; reject `remoteType === "azdo"` with the `docs/azdo-gap.md` pointer; reject a missing/empty `allowedUsers` or `agentUser` with an actionable message naming the `config set` subcommand.
4. `getIssueConversation()` → `analyzeConversation()`.
5. If `!hasNewMessage && !options.force`: write the "no new messages" explanation to stdout and return with exit 0, posting nothing.
6. Compose the prompt: configured `prompts.checkIssue` (or the default), then `Issue #<n>: <title>`, the URL, then the formatted conversation; pass through the existing `withPush()` helper.
7. Post the marker comment as the agent account (`postComment`); on failure write the error and exit 1 **before** any AI invocation.
8. Invoke the selected executor through the existing `invokeSelectedExecutor()`.

### CLI configuration (`src/commands/config.ts`)

- `config set allowed-users <value>` — splits on commas, trims, drops empty entries, and rejects an all-empty value with exit 1.
- `config set agent-user <value>` — trims and rejects an empty value with exit 1.

Both read the raw config and write it back, matching the existing `config set` subcommands.

### Wizard (`src/config/ConfigWizard.tsx`)

- `MAIN_MENU_OPTIONS` gains a fourth entry, `Issue Watch`, appended so existing menu indices (and the existing navigation tests) are unaffected. It leads to an allowed-users text screen, then an agent-user text screen, which saves and exits.
- `PROMPTS_MENU_OPTIONS` gains `Check-Issue`, appended after `Fix-Comments`; saving writes `.automata/check-issue-prompt.md` and stores the filename, exactly like the other prompt screens.

### Testing strategy

- `tests/unit/issueConversation.test.ts` covers the analysis rules directly: boundary from the last agent comment, first-execution behaviour, agent messages never counted as new, non-allowed authors excluded from both detection and output, case-insensitive matching, strict-inequality tie-breaking, chronological ordering and the rendered format.
- `tests/unit/executePromptCheckIssue.cmd.test.ts` mocks the config store, the GitHub service and both AI services (the established `execute-prompt` test pattern) and covers: happy path prompt content, marker comment posted before invocation, no-new-message exit 0 with nothing posted, `--force`, missing `allowedUsers` / `agentUser`, `azdo` rejection, invalid issue number, marker-comment failure aborting, executor/model/silent forwarding and `--push`.
- `tests/unit/config.cmd.test.ts` and `tests/unit/ConfigWizard.test.tsx` extend the existing suites for the new settings.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Trust settings stored in `.automata/config.json` rather than passed as flags (principle V prefers flags) | `allowedUsers` and `agentUser` are stable per-repository trust settings; requiring them on every invocation would make the polling use case unusable and invite copy-paste mistakes in the list of people allowed to command the agent | Flags/env only: rejected because the request explicitly places these values in configuration, and the file already stores directly comparable settings (`issueDiscoveryValue`, `claudeSystemPrompt`) |
