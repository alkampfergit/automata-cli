# Spec Decisions: SonarCloud Integration, Expanded Config, and Execute-Prompt Command

**Branch**: `010-sonarcloud-prompts-execute`  
**Date**: 2026-04-01  
**Spec**: [specs/010-sonarcloud-prompts-execute/spec.md](spec.md)  
**Plan**: [specs/010-sonarcloud-prompts-execute/plan.md](plan.md)  
**Research**: [specs/010-sonarcloud-prompts-execute/research.md](research.md)

## Planning Decisions

- **SonarCloud detection**: Match `sonarcloud.io` in the check's `detailsUrl`. **Rationale**: Checks already carry `detailsUrl`; URL pattern is stable across SonarCloud versions. **Alternatives considered**: Matching check name string (fragile, locale-dependent).

- **HTTP fetch for SonarCloud API**: Use global `fetch` (available in Node 18+). **Rationale**: Simpler than importing `node:https`; project targets Node LTS 18+. **Alternatives considered**: `node:https` with callback-based API (more boilerplate, no real benefit).

- **Config wizard rewrite**: Add `"main"` screen as new entry point; existing screens become sub-flows. **Rationale**: Minimal structural change to existing Ink component while enabling menu navigation. **Alternatives considered**: Full component split (over-engineering for current scope).

- **execute-prompt command location**: New file `src/commands/executePrompt.ts`, registered in `index.ts`. **Rationale**: Consistent with the existing pattern of one file per command group. **Alternatives considered**: Adding to `git.ts` (wrong conceptual grouping — AI invocation, not git workflow).

- **Default Sonar prompt**: Defined as exported constant `DEFAULT_SONAR_PROMPT` in `configStore.ts`. **Rationale**: Co-located with config schema; easy to find and override. **Alternatives considered**: Inline in executePrompt.ts (would hide the user-facing default).
