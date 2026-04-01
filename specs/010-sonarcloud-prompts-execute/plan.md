# Implementation Plan: SonarCloud Integration, Expanded Config, and Execute-Prompt Command

**Branch**: `010-sonarcloud-prompts-execute` | **Date**: 2026-04-01 | **Spec**: [spec.md](spec.md)

## Summary

Extend `get-pr-info` to detect SonarCloud checks, fetch new-issue counts from the public SonarCloud API, and include results in output. Expand the config schema with a `prompts.sonar` field, rewrite the config wizard as a menu-driven UI, and add an `execute-prompt sonar` command that invokes Claude (or Codex) with the Sonar prompt and the SonarCloud analysis URL.

## Technical Context

**Language/Version**: TypeScript 5.x strict  
**Primary Dependencies**: commander.js, ink, react, vitest  
**Storage**: `.automata/config.json`  
**Testing**: vitest  
**Target Platform**: Node.js 18+ CLI  
**Project Type**: CLI tool  

## Constitution Check

- ✅ CLI-First: all features exposed as commander.js commands/subcommands
- ✅ TypeScript strict: no `any`, explicit types throughout
- ✅ Single Responsibility: SonarCloud fetch isolated to `gitService.ts`; wizard is UI only
- ✅ Simplicity: no new abstractions; `fetch` is global in Node 18+

## Project Structure

### Documentation (this feature)

```text
specs/010-sonarcloud-prompts-execute/
├── plan.md
├── research.md
├── spec.md
├── checklists/requirements.md
├── pr-report.md
├── spec-decisions.md
└── tasks.md
```

### Source Code Changes

```text
src/
├── config/
│   ├── configStore.ts        ← add prompts field to AutomataConfig + DEFAULT_SONAR_PROMPT
│   └── ConfigWizard.tsx      ← rewrite with main menu (main → remote/implement-next/prompts)
├── git/
│   └── gitService.ts         ← add sonarcloudUrl + sonarNewIssues to PrInfo; fetch from API
├── commands/
│   ├── executePrompt.ts      ← NEW: execute-prompt sonar command
│   └── git.ts                ← update output formatting for sonar fields
└── index.ts                  ← register executePromptCommand

tests/unit/
├── configStore.test.ts       ← add prompts field round-trip tests
├── git.commands.test.ts      ← add SonarCloud output tests
└── executePrompt.cmd.test.ts ← NEW: unit tests for execute-prompt sonar
```

## Implementation Steps

### Step 1 — Config schema extension
- Add `prompts?: { sonar?: string }` to `AutomataConfig`
- Export `DEFAULT_SONAR_PROMPT` constant

### Step 2 — SonarCloud detection in gitService
- In `getPrInfoGh`, after building `checks`, find a check whose `detailsUrl` includes `sonarcloud.io`
- Extract project key from URL query param `id=`
- Use `fetch` to call SonarCloud API for new-issue count
- Add `sonarcloudUrl?: string` and `sonarNewIssues?: number | null` to `PrInfo`
- Return gracefully when API fails (`sonarNewIssues: null`)

### Step 3 — ConfigWizard rewrite
- Add `"main"` screen as entry point with three options
- "Remote / Mode": existing remote → technique → value screens
- "Implement-Next": technique + value screens only
- "Prompts": new screen showing Sonar prompt text editor
- All existing config keys preserved

### Step 4 — executePrompt command
- `src/commands/executePrompt.ts`: new Command `execute-prompt`
- Subcommand `sonar`: gets current branch, calls `getPrInfo`, extracts `sonarcloudUrl`
- Builds final prompt from config or default + URL
- Invokes `invokeClaudeCode` or `invokeCodexCode`

### Step 5 — Register in index.ts

### Step 6 — Update human-readable and JSON output in git.ts

### Step 7 — Tests

### Step 8 — Docs update
