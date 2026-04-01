# Tasks: SonarCloud Integration, Expanded Config, and Execute-Prompt Command

**Branch**: `010-sonarcloud-prompts-execute` | **Date**: 2026-04-01

## Tasks

- [ ] T01 — Extend `AutomataConfig` in `configStore.ts`: add `prompts?: { sonar?: string }` field and export `DEFAULT_SONAR_PROMPT` constant
- [ ] T02 — Extend `PrInfo` interface in `gitService.ts`: add optional `sonarcloudUrl?: string` and `sonarNewIssues?: number | null`
- [ ] T03 — Add SonarCloud detection + API fetch in `getPrInfoGh`: detect check by `sonarcloud.io` in detailsUrl, extract project key and PR number, fetch new-issue count
- [ ] T04 — Update human-readable and `--json` output in `git.ts` to display SonarCloud fields when present
- [ ] T05 — Rewrite `ConfigWizard.tsx` with a top-level main menu (Remote/Mode, Implement-Next, Prompts) and a Sonar prompt editing screen
- [ ] T06 — Create `src/commands/executePrompt.ts` with `execute-prompt sonar` command supporting `--codex` and `--verbose`
- [ ] T07 — Register `executePromptCommand` in `src/index.ts`
- [ ] T08 — Write unit tests for `configStore.ts` (prompts field round-trip)
- [ ] T09 — Write unit tests for `git.commands.test.ts` (SonarCloud fields in output)
- [ ] T10 — Write unit tests for `executePrompt.cmd.test.ts`
- [ ] T11 — Update `docs/git.md` with SonarCloud fields documentation
- [ ] T12 — Create `docs/execute-prompt.md` with execute-prompt command documentation
- [ ] T13 — Run `npm test && npm run lint` and fix any issues
