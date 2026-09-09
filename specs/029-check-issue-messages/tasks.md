# Tasks: Check Issue For New Messages

**Input**: Design documents from `specs/029-check-issue-messages/`
**Prerequisites**: `spec.md`, `research.md`, `plan.md`

## Phase 1: Configuration model

- [ ] T001 Extend `src/config/configStore.ts` with `allowedUsers?: string[]`, `agentUser?: string`, `AutomataPrompts.checkIssue`, and the exported `DEFAULT_CHECK_ISSUE_PROMPT` constant (FR-002, FR-003, FR-016)
- [ ] T002 Resolve `prompts.checkIssue` through the existing `resolvePromptRef()` in `readConfig()` so `.md` file references work like the other prompts (FR-016)
- [ ] T003 Add `config set allowed-users <value>` (comma-separated, trimmed, empty entries dropped, all-empty rejected) and `config set agent-user <value>` (trimmed, empty rejected) to `src/commands/config.ts` (FR-004)

## Phase 2: GitHub issue retrieval

- [ ] T004 Add `IssueComment`, `IssueConversation` and `getIssueConversation()` to `src/config/githubService.ts`, calling `gh issue view <n> --json number,title,body,url,author,createdAt,comments`, flattening `author.login`, sorting comments ascending by `createdAt`, and surfacing `gh` stderr on failure (FR-001)

## Phase 3: Conversation analysis (tests first)

- [ ] T005 Write `tests/unit/issueConversation.test.ts` covering: boundary taken from the newest agent comment; first-execution behaviour with and without an allowed issue author; agent messages never counted as new even when the agent is listed as allowed; non-allowed authors excluded from detection and from output; case-insensitive login matching; strict-inequality tie-breaking; chronological ordering; rendered `NEW since last agent run` marker (FR-006 – FR-010, FR-014, FR-015, FR-019)
- [ ] T006 Implement `src/github/issueConversation.ts` with `ConversationMessage`, `ConversationAnalysis`, `analyzeConversation()` and `formatConversation()` as pure functions, until T005 passes (FR-006 – FR-010, FR-014, FR-015, FR-019)

## Phase 4: `check-issue` subcommand

- [ ] T007 Add the `check-issue <issue-number>` subcommand to `src/commands/executePrompt.ts` using the shared `addAiOptions()` helper plus `--force`, and register it on the `execute-prompt` group (FR-001, FR-017, FR-018)
- [ ] T008 Validate inputs in the subcommand: executor via `resolveExecutor()`, positive-integer issue number, `remoteType === "azdo"` rejected with the `docs/azdo-gap.md` pointer, missing/empty `allowedUsers` and `agentUser` rejected with messages naming the `config set` subcommand (FR-005, FR-020)
- [ ] T009 Wire detection: fetch the conversation, analyse it, and when there is no new message and `--force` was not given, write the explanation to stdout, post nothing, and exit 0 (FR-007, FR-011)
- [ ] T010 Compose the prompt from `prompts.checkIssue` (or the default) plus issue number, title, URL and the formatted conversation, passed through the existing `withPush()` helper (FR-013, FR-014, FR-016, FR-018)
- [ ] T011 Post the marker comment as the agent account before invoking the AI, aborting with exit 1 if it fails, then invoke the selected executor via `invokeSelectedExecutor()` (FR-012)

## Phase 5: Interactive configuration

- [ ] T012 Add an `Issue Watch` entry (appended last) to `MAIN_MENU_OPTIONS` in `src/config/ConfigWizard.tsx` with allowed-users and agent-user text screens that save both values (FR-004)
- [ ] T013 Add a `Check-Issue` entry (appended last) to `PROMPTS_MENU_OPTIONS` that writes `.automata/check-issue-prompt.md` and stores the filename, matching the other prompt screens (FR-016)

## Phase 6: Command and configuration tests

- [ ] T014 Write `tests/unit/executePromptCheckIssue.cmd.test.ts` covering: prompt content (issue number, title, URL, filtered conversation); marker comment posted before AI invocation; no-new-message exit 0 with nothing posted; `--force`; missing `allowedUsers`; missing `agentUser`; `azdo` rejection; invalid issue number; marker-comment failure aborting before invocation; executor selection, `--model`, `--silent` and `--push` forwarding (FR-005, FR-011 – FR-013, FR-017, FR-018, FR-020)
- [ ] T015 Extend `tests/unit/config.cmd.test.ts` for `config set allowed-users` (parsing, trimming, empty rejection) and `config set agent-user` (FR-004)
- [ ] T016 Extend `tests/unit/ConfigWizard.test.tsx` for the `Issue Watch` screens and the `Prompts → Check-Issue` screen, and add `DEFAULT_CHECK_ISSUE_PROMPT` to the config-store mock (FR-004, FR-016)
- [ ] T017 Extend `tests/unit/configStore.test.ts` for `prompts.checkIssue` file-reference resolution (FR-016)

## Phase 7: Documentation

- [ ] T018 Add the `automata execute-prompt check-issue` reference section to `docs/execute-prompt.md`: synopsis, options table, how-it-works, detection rule, prompt configuration, exit codes (FR-021)
- [ ] T019 Document `allowedUsers`, `agentUser` and `prompts.checkIssue` in `docs/config.md`, including the `config set` subcommands, the prompt file-reference rules and the wizard filename mapping (FR-021)
- [ ] T020 Add a `check-issue` example under the `automata execute-prompt` section of `README.md`, keeping the README small per the documentation convention (FR-021)

## Phase 8: Validation

- [ ] T021 Run `npm test && npm run lint` and fix any failures (SC-005)
