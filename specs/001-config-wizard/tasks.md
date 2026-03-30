# Tasks: Config Wizard

**Input**: Design documents from `/specs/001-config-wizard/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install dependencies and configure project for ink/TSX support

- [ ] T001 Install ink and react runtime dependencies: `npm install ink react`
- [ ] T002 Install TypeScript types: `npm install --save-dev @types/react`
- [ ] T003 Add `"jsx": "react-jsx"` to `compilerOptions` in `tsconfig.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Config store module and directory creation — required by both user stories

- [ ] T004 Create `src/config/configStore.ts` — exports `readConfig()`, `writeConfig()`, `AutomataConfig` type, `RemoteType` type; creates `.automata/` dir on write
- [ ] T005 Create `tests/unit/configStore.test.ts` — unit tests for `readConfig` (missing file, corrupted JSON, valid file) and `writeConfig` (creates dir, writes valid JSON)

**Checkpoint**: Config store complete — user story implementation can now begin

---

## Phase 3: User Story 1 — Interactive Config Wizard (Priority: P1) 🎯 MVP

**Goal**: `automata config` launches an ink-powered interactive selector to set `remoteType`

**Independent Test**: Run `node dist/index.js config`, select an option, confirm, verify `.automata/config.json`.

### Implementation for User Story 1

- [ ] T006 [US1] Create `src/config/ConfigWizard.tsx` — ink React component with a two-option list selector (GitHub / Azure DevOps), arrow-key navigation, pre-selects current value, writes config on Enter, exits cleanly on Ctrl+C
- [ ] T007 [US1] Create `src/commands/config.ts` — commander.js `config` command that calls `render(<ConfigWizard />)` from ink; no subcommand invocation
- [ ] T008 [US1] Register the `config` command in `src/index.ts` by importing and attaching `src/commands/config.ts`
- [ ] T009 [US1] Build and smoke-test: `npm run build` succeeds with zero errors/warnings

**Checkpoint**: US1 complete — `automata config` launches wizard and saves `.automata/config.json`

---

## Phase 4: User Story 2 — Non-Interactive Config Set (Priority: P2)

**Goal**: `automata config set type <gh|azdo>` sets config without the wizard

**Independent Test**: Run `node dist/index.js config set type gh`, verify output and `.automata/config.json`.

### Implementation for User Story 2

- [ ] T010 [US2] Add `config set` and `config set type <value>` subcommands to `src/commands/config.ts`; validate `value` is `gh` or `azdo`, print success to stdout or error to stderr with exit code 1
- [ ] T011 [US2] Create `tests/unit/config.cmd.test.ts` — unit tests for `config set type gh`, `config set type azdo`, and `config set type invalid` (via `execSync`)

**Checkpoint**: US2 complete — both wizard and `config set type` work independently

---

## Phase 5: Polish & Cross-Cutting Concerns

- [ ] T012 [P] Run `npm test && npm run lint` and fix any failures
- [ ] T013 Update `README.md` to document `automata config` and `automata config set type` commands per constitution requirement

---

## Dependencies & Execution Order

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — blocks US1 and US2
- **Phase 3 (US1)**: Depends on Phase 2
- **Phase 4 (US2)**: Depends on Phase 2; T010 depends on T007 (shares `config.ts`)
- **Phase 5 (Polish)**: Depends on all user stories complete

### Parallel Opportunities

- T004 and T005 can run in parallel (different files)
- T006, T007 are sequential (T007 imports T006)
- T010 and T011 can run in parallel (different files, T010 after T007)

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 + Phase 2
2. Complete Phase 3 (T006 → T007 → T008 → T009)
3. Validate: `node dist/index.js config` shows ink UI and saves config

### Incremental Delivery

1. Setup + Foundational → config store working
2. US1 (wizard) → ink UI tested manually
3. US2 (config set) → non-interactive path tested
4. Polish → lint/tests pass, README updated
