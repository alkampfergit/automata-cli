# Tasks: Dependency Refresh & Vulnerability Remediation

**Branch**: `feature/031-dependency-updates` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

`[P]` marks tasks that can run in parallel with the others in their group.

## Phase 1: Baseline (US1, US3)

- [X] T001 Record the pre-change baseline: `npm audit` (9 advisories: 1 low, 3 moderate, 5 high),
      `npm audit --omit=dev` (1 high, `ws`), and `npm test` (26 files / 668 tests passing). Captured in
      `research.md` § Baseline. Without this the success criteria are unverifiable.
- [X] T002 Classify each advisory by whether it reaches production, to establish that only `ws` (via `ink`) ships to
      consumers. Recorded as the table in `research.md` § Baseline.

## Phase 2: Manifest & lockfile (US1, US2)

- [X] T003 Verify the advisories are reachable without forcing anything: run `npm audit fix` and confirm it reaches
      `found 0 vulnerabilities` with the diff limited to `package-lock.json`. Establishes Decision 1.
- [X] T004 Bump runtime dependencies in `package.json`: `commander` -> `^15.0.0`, `ink` -> `^7.1.1`,
      `react` -> `^19.3.0`.
- [X] T005 Bump devDependencies in `package.json`: `@types/react` -> `^19.3.0`, `eslint` -> `^10.10.0`,
      `prettier` -> `^3.9.6`, `typescript-eslint` -> `^8.70.0`, `vitest` -> `^5.0.0`.
- [X] T006 Evaluate `typescript@7.0.2`: attempt the install, record the `ERESOLVE` against `typescript-eslint@8.70.0`
      and the 324 `tsc --noEmit` errors, then revert to `^5.9.3`. Establishes Decision 3.
- [X] T007 [P] Evaluate `@types/node@26`: confirm DefinitelyTyped tags `22.20.2` as `latest`, that `npm outdated` does
      not list the package, and that 26.x would over-type against Node 24 LTS. Leave at `^25.5.0`. Establishes
      Decision 4.
- [X] T008 [P] Determine why `esbuild` resolves downward: confirm `tsup@8.5.1` declares `esbuild@^0.27.0` and that the
      advisory range `0.27.3 - 0.28.0` leaves `0.27.2` as the only safe in-range version. Decide against an `overrides`
      entry. Establishes Decision 5.
- [X] T009 Add `"engines": { "node": ">=22.12.0" }` to `package.json`, derived from the measured engine fields of
      `commander@15` (`>=22.12.0`) and `ink@7` (`>=22`). Establishes Decision 7. Depends on T004.
- [X] T010 Regenerate `package-lock.json` and confirm `npm audit` reports `found 0 vulnerabilities` for the full tree
      **and** for `--omit=dev`. Satisfies FR-001, FR-002, FR-005, SC-001, SC-002. Depends on T004, T005, T009.

## Phase 3: Test adaptation (US3)

- [X] T011 Reproduce and isolate the `ink@7` regression: 11 of 44 `ConfigWizard` tests fail on Esc navigation;
      reinstalling `ink@6` with all other upgrades in place restores 44/44, proving `ink` is the sole cause.
- [X] T012 Diagnose the root cause in `node_modules/ink/build/input-parser.js` and `components/App.js`: a trailing ESC
      byte is held as pending input and flushed after `pendingInputFlushDelayMilliseconds = 20`, while the test's
      `tick()` advanced only microtasks. Confirm `parseKeypress` still maps a lone ESC to `{name: 'escape'}` so no
      source change is needed. Establishes Decision 6.
- [X] T013 Extend `tick()` in `tests/unit/ConfigWizard.test.tsx` with a 30 ms real-time wait (`ESC_FLUSH_MS`), carrying
      a comment that names ink's escape-disambiguation behaviour. Satisfies FR-008. Depends on T012.
- [X] T014 Confirm `tests/unit/ConfigWizard.test.tsx` passes 44/44 on `ink@7` with no assertion weakened, no test
      skipped and no test removed. Satisfies FR-007. Depends on T013.

## Phase 4: Verification (US3)

- [X] T015 Run `npm run build` and confirm tsup emits `dist/index.js` with zero errors. Satisfies FR-009.
- [X] T016 Run `npm test` and confirm 26 files / 668 tests pass — the same count as the T001 baseline, with no skips.
      Satisfies FR-007, SC-003.
- [X] T017 [P] Run `npm run lint` and confirm exit 0. Satisfies FR-009, SC-004.
- [X] T018 [P] Run `npm run typecheck` and confirm exit 0. Satisfies FR-009, SC-004.
- [X] T019 Run `npm outdated` and confirm no direct dependency is upgradable except the deferred `typescript`.
      Satisfies FR-003, SC-005, SC-006.
- [X] T020 Confirm `git diff --stat` shows no file under `src/` changed. Satisfies FR-010.
- [X] T021 Run `npm ci` from the committed lockfile and re-run `npm audit` to prove the audited tree is reproducible,
      not an artifact of the incremental installs. Satisfies FR-005.

## Phase 5: Documentation

- [X] T022 Add `docs/maintenance.md`: the dependency-refresh policy, the supported Node floor, the two deferred
      upgrades (`typescript`, `@types/node`) with their exact unblocking conditions, and the `esbuild` pin as a watch
      item. Satisfies FR-004, FR-011 and the `AGENTS.md` convention that detail lives under `docs/`.
- [X] T023 [P] Correct `AGENTS.md`: "Node.js LTS (18+)" -> the actual supported floor.
- [X] T024 [P] Update `README.md` — dev-setup Node prerequisite and a link to `docs/maintenance.md` from the command
      table area. Nothing else in the README changes, per the documentation convention.

## Dependencies

- Phase 2 depends on Phase 1 (the baseline is the comparison point).
- Phase 3 depends on Phase 2 (the failure only appears once `ink@7` is installed).
- Phase 4 depends on Phases 2 and 3.
- Phase 5 depends on Phase 4 — the docs must state what was verified, not what was planned.

## Traceability

| Requirement | Tasks |
|---|---|
| FR-001, FR-002 | T003, T010 |
| FR-003 | T004, T005, T019 |
| FR-004 | T006, T007, T008, T022 |
| FR-005 | T010, T021 |
| FR-006 | T009 |
| FR-007 | T014, T016 |
| FR-008 | T013 |
| FR-009 | T015, T017, T018 |
| FR-010 | T020 |
| FR-011 | T022, T023, T024 |
