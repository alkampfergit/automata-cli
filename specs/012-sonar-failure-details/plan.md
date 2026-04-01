# Implementation Plan: Sonar Failure Details in get-pr-info

**Branch**: `012-sonar-failure-details` | **Date**: 2026-04-01 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/012-sonar-failure-details/spec.md`

## Summary

Extend the existing GitHub `get-pr-info` flow so that a failing SonarCloud check can return richer failure data. The implementation will preserve existing Sonar detection and new-issue count behavior, add structured Sonar failure data to `PrInfo`, render a dedicated `Sonar Failures:` section in human-readable output, and document the private-project case when SonarCloud responds with HTTP 401.

## Technical Context

**Language/Version**: TypeScript 5.x strict  
**Primary Dependencies**: commander.js, vitest, built-in `fetch` in Node.js 18+  
**Storage**: N/A  
**Testing**: vitest  
**Target Platform**: Node.js 18+ CLI  
**Project Type**: CLI tool  
**Performance Goals**: Keep Sonar detail lookups bounded to the current PR and comparable to the existing Sonar new-issues fetch  
**Constraints**: Preserve current `get-pr-info` behavior for non-Sonar cases; keep errors non-fatal when Sonar detail enrichment is unavailable  
**Scale/Scope**: One command group (`git get-pr-info`), one service module, focused docs and unit tests

## Constitution Check

- ✅ CLI-First: the feature extends an existing commander command and preserves `--json` support.
- ✅ TypeScript strictness: new Sonar payload types will be explicitly modeled with no `any`.
- ✅ Single responsibility: Sonar fetching stays inside `src/git/gitService.ts`; formatting stays in `src/commands/git.ts`.
- ✅ Simplicity: reuse the existing Sonar detection path and Node.js built-in `fetch`; avoid new dependencies.

## Project Structure

### Documentation (this feature)

```text
specs/012-sonar-failure-details/
├── spec.md
├── research.md
├── plan.md
├── tasks.md
├── pr-report.md
├── spec-decisions.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
src/
├── git/
│   └── gitService.ts     # enrich PrInfo with structured Sonar failure details
└── commands/
    └── git.ts            # render Sonar failure details in human-readable output

tests/
└── unit/
    └── git.commands.test.ts

docs/
└── git.md
```

**Structure Decision**: Keep the change inside the existing GitHub PR service and command formatter paths because the feature is an output enrichment, not a new workflow.

## Implementation Steps

### Step 1 — Extend Sonar models in `gitService.ts`

- Add explicit interfaces for Sonar gate violations, Sonar issue details, and Sonar failure summary metadata on `PrInfo`.
- Preserve the existing `sonarcloudUrl` and `sonarNewIssues` fields for compatibility.

### Step 2 — Fetch and map Sonar failure details

- Detect a failing Sonar check using the existing Sonar URL match.
- Query SonarCloud quality gate details for the PR and map failing conditions into structured gate-violation entries.
- Query SonarCloud PR issues and map available fields such as rule, severity, type, message, file path, line, and explanation.
- Detect HTTP 401 and mark the Sonar failure summary as a private-project case with guidance text.

### Step 3 — Render the new Sonar section in `git.ts`

- Keep current PR summary and `FailedChecks:` behavior intact.
- Add a dedicated trailing `Sonar Failures:` section when the Sonar failure summary contains gate violations, issues, or a private-project note.
- Leave successful or non-Sonar output unchanged apart from the new optional section.

### Step 4 — Add unit coverage

- Cover public Sonar failure rendering in human-readable mode.
- Cover private-project handling when the Sonar API returns 401.
- Cover JSON shape for structured Sonar failure data.
- Confirm no Sonar failure section appears for passing Sonar checks.

### Step 5 — Update documentation

- Extend `docs/git.md` with the new `Sonar Failures:` section behavior and JSON fields.

## Complexity Tracking

No constitution violations expected.
