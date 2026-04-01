# Tasks: Sonar Failure Details in get-pr-info

**Branch**: `012-sonar-failure-details` | **Date**: 2026-04-01
**Input**: Design documents from `/specs/012-sonar-failure-details/`
**Prerequisites**: plan.md, spec.md, research.md

## Phase 1: Setup

- [ ] T001 Create feature artifacts in `specs/012-sonar-failure-details/`

## Phase 2: Foundational

- [ ] T002 Extend `PrInfo` and related Sonar types in `src/git/gitService.ts`
- [ ] T003 Add SonarCloud failure-detail fetching and private-project detection in `src/git/gitService.ts`
- [ ] T004 Add human-readable Sonar failure rendering in `src/commands/git.ts`

## Phase 3: User Story 1 - Inspect Public Sonar Failures from the CLI (Priority: P1) 🎯 MVP

**Goal**: Show actionable Sonar gate and issue details in normal `get-pr-info` output for public failing Sonar checks.

**Independent Test**: Run `automata git get-pr-info` against a mocked public failing Sonar PR and verify the `Sonar Failures:` section lists gate violations and issues.

### Tests for User Story 1

- [ ] T005 [P] [US1] Add human-readable failing-public-Sonar coverage in `tests/unit/git.commands.test.ts`

### Implementation for User Story 1

- [ ] T006 [US1] Map failing quality gate conditions into structured Sonar failure data in `src/git/gitService.ts`
- [ ] T007 [US1] Map PR-scoped Sonar issues into structured Sonar failure data in `src/git/gitService.ts`
- [ ] T008 [US1] Render public Sonar gate and issue details in `src/commands/git.ts`

## Phase 4: User Story 2 - Consume Sonar Failure Details Programmatically (Priority: P2)

**Goal**: Expose structured Sonar failure data through `--json`.

**Independent Test**: Run `automata git get-pr-info --json` against a mocked public failing Sonar PR and verify the structured gate and issue objects.

### Tests for User Story 2

- [ ] T009 [P] [US2] Add JSON Sonar failure payload coverage in `tests/unit/git.commands.test.ts`

### Implementation for User Story 2

- [ ] T010 [US2] Return structured Sonar failure data from `getPrInfo` in `src/git/gitService.ts`

## Phase 5: User Story 3 - Handle Private SonarCloud Projects Gracefully (Priority: P3)

**Goal**: Explain the private-project/authentication case without failing the command.

**Independent Test**: Run `automata git get-pr-info` and `--json` against a mocked Sonar 401 response and verify the private-project note and URL guidance.

### Tests for User Story 3

- [ ] T011 [P] [US3] Add private-project Sonar coverage in `tests/unit/git.commands.test.ts`

### Implementation for User Story 3

- [ ] T012 [US3] Map Sonar HTTP 401 responses to a private-project note in `src/git/gitService.ts`
- [ ] T013 [US3] Render the private-project note in `src/commands/git.ts`

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T014 [P] Update `docs/git.md` with `Sonar Failures:` output and JSON schema
- [ ] T015 Run `npm test && npm run lint`
- [ ] T016 Mark completed tasks in `specs/012-sonar-failure-details/tasks.md`
