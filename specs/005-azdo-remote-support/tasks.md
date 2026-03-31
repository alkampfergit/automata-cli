# Tasks: Azure DevOps Remote Support

**Input**: `specs/005-azdo-remote-support/plan.md`, `spec.md`, `research.md`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: AzDO Service (US1 + US2 foundation)

**Purpose**: New azdo service module that wraps `azdo pr status --json` into a `PrInfo`

- [ ] T001 [US1] Create `src/config/azdoService.ts` — `getPrInfo(branch): PrInfo | null` calling `azdo pr status --json`, mapping `status` active→OPEN, completed→MERGED, abandoned→CLOSED; empty `checks` array
- [ ] T002 [US1] Create `tests/unit/azdoService.test.ts` — unit tests: returns null when no PRs, maps active→OPEN, maps completed→MERGED, maps abandoned→CLOSED, throws ENOENT when azdo not installed, throws on non-zero exit

**Checkpoint**: `npm test` passes with new azdo service tests green

---

## Phase 2: PR Info Dispatch in gitService (US1 + US2)

**Purpose**: `getPrInfo` in `gitService.ts` dispatches to gh or azdo based on config

- [ ] T003 [US1] Modify `src/git/gitService.ts` — `getPrInfo(branch)` reads `remoteType` from config; calls `azdoService.getPrInfo(branch)` when `"azdo"`, existing gh call otherwise
- [ ] T004 [US1] Update `tests/unit/git.commands.test.ts` — add test cases for `getPrInfo` in azdo mode (mock azdoService returning a PrInfo, verify it passes through)

**Checkpoint**: `npm test` still fully green; `get-pr-info` command works end-to-end in azdo mode (manual verification)

---

## Phase 3: get-ready AzDO Error Message (US3)

**Purpose**: Clear error for unsupported azdo mode with gap doc reference

- [ ] T005 [US3] Modify `src/commands/getReady.ts` — replace "get-ready is only available for GitHub (gh) mode" with a message that mentions `docs/azdo-gap.md`
- [ ] T006 [US3] Update `tests/unit/getReady.cmd.test.ts` — update/add test asserting the new error message and exit code 1 for azdo mode

**Checkpoint**: `npm test` passes; `automata get-ready` with azdo config prints correct message

---

## Phase 4: Gap Documentation (US4)

**Purpose**: Create `docs/azdo-gap.md` listing all unsupported capabilities

- [ ] T007 [P] [US4] Create `docs/azdo-gap.md` — document: (1) work item listing/discovery, (2) PR check/policy status; include azdo-cli version, what is supported, what is not, and what would close each gap

**Checkpoint**: `docs/azdo-gap.md` is complete and accurate

---

## Phase 5: Final Validation

- [ ] T008 Run `npm test && npm run lint` — all tests green, zero lint errors
- [ ] T009 [P] Verify `docs/azdo-gap.md` covers all gaps found in research.md

---

## Dependencies & Execution Order

- T001 → T002 (tests require the module)
- T001 → T003 (dispatch requires azdoService)
- T003 → T004 (test requires dispatch to exist)
- T005 → T006 (test requires updated message)
- T007 is independent (docs only)
- T008 depends on T001–T007 all complete
