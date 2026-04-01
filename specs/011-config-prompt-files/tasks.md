# Tasks: Config Prompt Files

**Input**: Design documents from `/specs/011-config-prompt-files/`
**Branch**: `011-config-prompt-files`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: No new project structure needed — changes are confined to existing files.

- [ ] T001 Read `src/config/configStore.ts` to understand current types, `readConfig()`, and `writeConfig()` before making changes

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Add the `resolvePromptRef()` helper — all user stories depend on it.

**⚠️ CRITICAL**: Must be complete before US1 and US3 implementation.

- [ ] T002 Add `resolvePromptRef(value: string, automataDir: string): string` helper to `src/config/configStore.ts`:
  - If `value` ends with `.md`, resolve full path via `path.resolve(automataDir, value)`
  - Reject paths outside `automataDir` with a thrown `Error`
  - Read and return file contents via `readFileSync`
  - Otherwise return `value` unchanged
- [ ] T003 Add `automataDir()` helper to `src/config/configStore.ts` returning `join(process.cwd(), ".automata")` (reuse existing pattern from `configPath()`)
- [ ] T004 Write unit tests for `resolvePromptRef()` in `tests/config/configStore.test.ts`:
  - Inline string → returned unchanged
  - `.md` filename → returns file contents
  - Missing `.md` file → throws with clear message
  - Path traversal (e.g., `../secret.md`) → throws

**Checkpoint**: `resolvePromptRef()` exists, is tested, and passes.

---

## Phase 3: User Story 1 — Resolve Prompt Refs in readConfig (Priority: P1) 🎯 MVP

**Goal**: `readConfig()` automatically resolves `.md` file references for all prompt fields.

**Independent Test**: Set `"claudeSystemPrompt": "claude-system-prompt.md"` in `.automata/config.json`, place content in `.automata/claude-system-prompt.md`, call `readConfig()` — confirm it returns the file contents.

### Implementation

- [ ] T005 [US1] Update `readConfig()` in `src/config/configStore.ts` to call `resolvePromptRef()` on `claudeSystemPrompt`, `prompts.sonar`, and `prompts.fixComments` after parsing JSON
- [ ] T006 [US1] Add integration test to `tests/config/configStore.test.ts`:
  - `readConfig()` with `.md` ref returns file contents
  - `readConfig()` with inline string returns string unchanged
- [ ] T007 [US1] Update `.automata/config.json` `claudeSystemPrompt` field to `"claude-system-prompt.md"` (the file already exists at `.automata/claude-system-prompt.md`)

**Checkpoint**: US1 — `readConfig()` resolves file references transparently.

---

## Phase 4: User Story 2 — Inline Strings Still Work (Priority: P2)

**Goal**: Existing inline configs continue to work without modification.

**Independent Test**: Set `"claudeSystemPrompt": "Do the task"` (no `.md` suffix), call `readConfig()` — returns `"Do the task"` unchanged.

### Implementation

- [ ] T008 [P] [US2] Confirm existing tests pass (no regressions) by running `npm test`
- [ ] T009 [US2] Add explicit regression test in `tests/config/configStore.test.ts` for an inline string value that does NOT end with `.md`

**Checkpoint**: US2 — Backward compatibility verified by tests.

---

## Phase 5: User Story 3 — Config Wizard Writes File References (Priority: P3)

**Goal**: The config wizard saves prompt field content to `.automata/<field>.md` and stores the filename in `config.json`.

**Independent Test**: Run the wizard, supply system prompt text, exit — verify `.automata/claude-system-prompt.md` contains the text and `config.json` has `"claudeSystemPrompt": "claude-system-prompt.md"`.

### Implementation

- [ ] T010 [US3] Read `src/config/ConfigWizard.tsx` system-prompt save handler (lines ~124-130)
- [ ] T011 [US3] Update system-prompt save handler in `src/config/ConfigWizard.tsx`:
  - Write content to `.automata/claude-system-prompt.md` via `writeFileSync`
  - Store `"claude-system-prompt.md"` as the `claudeSystemPrompt` value in `writeConfig()`
- [ ] T012 [US3] Update sonar-prompt save handler in `src/config/ConfigWizard.tsx`:
  - Write content to `.automata/sonar-prompt.md`
  - Store `"sonar-prompt.md"` as `prompts.sonar`
- [ ] T013 [US3] Update fix-comments-prompt save handler in `src/config/ConfigWizard.tsx`:
  - Write content to `.automata/fix-comments-prompt.md`
  - Store `"fix-comments-prompt.md"` as `prompts.fixComments`

**Checkpoint**: US3 — Wizard creates `.md` files and stores filenames.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T014 [P] Update `docs/config.md` to document the `.md` file reference convention: what it means, which fields support it, the filename mapping, and the path-traversal rule
- [ ] T015 Run `npm test && npm run lint` and fix any issues
- [ ] T016 [P] Update `AGENTS.md` Active Technologies section to note `.automata/*.md` prompt files

---

## Dependencies & Execution Order

- **Phase 1**: No dependencies
- **Phase 2 (T002–T004)**: Depends on Phase 1 — blocks US1 and US3
- **Phase 3 (T005–T007)**: Depends on Phase 2
- **Phase 4 (T008–T009)**: Can run in parallel with Phase 3 (different concerns)
- **Phase 5 (T010–T013)**: Depends on Phase 2; can run in parallel with Phase 3/4
- **Phase 6**: Depends on Phases 3–5

### Parallel Opportunities

- T008 and T009 (US2 regression) can run alongside T005–T007 (US1 implementation)
- T010–T013 (US3 wizard) can run after T002 alongside T005–T007
- T014 and T016 (docs) can run in parallel in Phase 6

---

## Implementation Strategy

### MVP (User Story 1 only)

1. Complete T001–T004 (Foundational)
2. Complete T005–T007 (US1)
3. Validate: `readConfig()` resolves `.md` refs, existing inline strings still work
4. Proceed to US2 and US3

### Incremental Delivery

1. Foundation → US1 (core read-time resolution) → US2 (backward compat tests) → US3 (wizard)
