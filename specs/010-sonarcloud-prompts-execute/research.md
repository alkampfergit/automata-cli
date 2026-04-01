# Research: SonarCloud Integration, Expanded Config, and Execute-Prompt Command

**Branch**: `010-sonarcloud-prompts-execute` | **Date**: 2026-04-01

## Codebase Analysis

### Existing PR info flow

`getPrInfoGh` in `src/git/gitService.ts` fetches `statusCheckRollup` from `gh pr view`. Each entry has `name`, `status`, `conclusion`, `description`, and `detailsUrl`. SonarCloud checks typically have a `detailsUrl` matching `sonarcloud.io`.

### SonarCloud URL pattern

SonarCloud check detail URLs follow this pattern:
`https://sonarcloud.io/summary/new_code?id=<project-key>&pullRequest=<number>`
or
`https://sonarcloud.io/project/issues?id=<project-key>&pullRequest=<number>`

Project key extraction: parse `id=<project-key>` query parameter from the check URL.

### SonarCloud public API

For public projects (no auth), to get new issues on a PR:
```
GET https://sonarcloud.io/api/issues/search?componentKeys=<project-key>&pullRequest=<pr-number>&resolved=false
```
Response: `{ "paging": { "total": N }, "issues": [...] }`

Node.js 18+ has global `fetch` — prefer it over `node:https` for simplicity.

### Config schema

Current `AutomataConfig` in `src/config/configStore.ts`:
- `remoteType`, `issueDiscoveryTechnique`, `issueDiscoveryValue`, `claudeSystemPrompt`

Extension needed: add `prompts?: { sonar?: string }`.

### ConfigWizard current structure

Linear flow: remote → technique → value → system-prompt (4 screens).
All logic in a single Ink component with `Screen` type and `useInput` handler.

### AI invocation patterns

- Claude: `invokeClaudeCode(prompt, { yolo, verbose, model })` in `src/claude/claudeService.ts`
- Codex: `invokeCodexCode(prompt, { yolo, verbose })` in `src/codex/codexService.ts`
- Pattern used in `getReady.ts` (implement-next) — follow exactly.

### Command registration

`src/index.ts` imports and registers commands. A new `executePromptCommand` must be added there.

### Test patterns

Tests in `tests/unit/`. Mock `node:child_process` spawnSync and `configStore`. Capture stdout/stderr via `vi.spyOn`. Pattern established in `git.commands.test.ts`.

## Autonomous Decisions

| Decision | Chosen | Rationale |
|----------|--------|-----------|
| SonarCloud detection method | Match `sonarcloud.io` in `detailsUrl` | Checks carry `detailsUrl`; URL pattern is stable |
| PR number extraction for API | From `raw.number` (already available in `getPrInfoGh`) | Already in scope |
| HTTP fetch method | Global `fetch` (Node 18+) | Simpler than `node:https`; project targets Node LTS 18+ |
| Default Sonar prompt | Hardcoded in `configStore.ts` near the type definition | Co-located with config schema |
| Config wizard top menu | Add `Screen = "main"` at start; existing screens become sub-screens | Minimal change to existing component structure |
| execute-prompt location | New file `src/commands/executePrompt.ts` | Consistent with existing command file pattern |
| execute-prompt sub-command | `sonar` only (as specified) | YAGNI |
| No `--yolo` on execute-prompt | Omitted | Not in feature description |
