# Implementation Plan: Dependency Refresh & Vulnerability Remediation

**Branch**: `feature/031-dependency-updates` | **Date**: 2026-09-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/031-update-all-npm/spec.md`

## Summary

Clear all 9 open advisories in the dependency tree and move every direct dependency to its latest publishable release.
The advisories are cleared by regenerating `package-lock.json` — no `package.json` change is strictly required for that
part. The "latest release" half brings three majors (`commander` 14→15, `ink` 6→7, `vitest` 4→5), which raises the
project's real Node.js floor to 22.12.0 and changes how `ink` delivers a bare Esc keypress. Both consequences are handled
explicitly: an `engines.node` field is added, and the wizard test helper is taught to wait past ink's 20 ms escape-flush
window. `typescript` stays on 5.x because `typescript-eslint` peer-rejects 7.x. Finally, the result is held by a publish-time gate:
`prepublishOnly` runs the production audit, so no vulnerable version reaches the registry. No file under `src/` changes.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode), unchanged by this feature

**Primary Dependencies**: commander 15 (CLI framework), ink 7 + react 19.3 (config wizard TUI)

**Storage**: N/A — no persistent data touched

**Testing**: vitest 5, 668 tests across 26 files; `ink-testing-library` 4 for the wizard

**Target Platform**: Node.js >= 22.12.0 on Linux/macOS/Windows (raised from an undeclared 18+)

**Project Type**: Single-project CLI, published to npm

**Performance Goals**: N/A — no runtime behaviour change intended

**Constraints**: Zero advisories in `npm audit` (full tree and `--omit=dev`); the full test suite green with no skips;
`lint`, `typecheck` and `build` all exit 0; a production advisory must block publishing without a dev advisory doing so

**Scale/Scope**: 13 direct dependencies; ~370 lockfile entries rewritten; 1 test helper adapted; 3 npm scripts added
(2 audits + 1 lifecycle hook); 1 test file added; 0 source files changed

## Constitution Check

*GATE: passed before Phase 0, re-checked after Phase 1.*

| Principle | Status | Note |
|---|---|---|
| I. CLI-First Design | PASS | No command surface is added, removed or altered. |
| II. TypeScript Strictness | PASS | `strict: true` unchanged; `tsc --noEmit` exits 0; no `any` introduced. |
| III. Single Responsibility Commands | PASS | No command code touched. |
| IV. npm Distribution | PASS | tsup remains the sole bundler and stays at 8.5.1. `bin` and `files` unchanged. Runtime dependency count stays at 3, honouring "dependencies included at runtime MUST be kept minimal". |
| V. Simplicity | PASS | No abstraction added. The deliberate simplicity choices are *not* adding an `overrides` block (Decision 5), *not* forcing peers with `--legacy-peer-deps` (Decision 3), and gating the audit on one `prepublishOnly` line rather than adding CI machinery (Decision 8). |
| Dev workflow: lint + typecheck before commit | PASS | Both run and green. |
| Dev workflow: tsup build zero errors | PASS | Verified. |
| Dev workflow: docs reviewed after a spec run | PASS | `docs/` gains a maintenance page; `README.md` dev-setup section gains the Node floor and the two audit scripts. |

No violations. **Complexity Tracking section omitted** — nothing to justify.

## Project Structure

### Documentation (this feature)

```text
specs/031-update-all-npm/
├── spec.md              # Phase 1 output
├── research.md          # Phase 0 output — the 7 upgrade decisions with measured evidence
├── plan.md              # This file
├── tasks.md             # Phase 2 output
├── pr-report.md         # Reviewer-facing summary
└── spec-decisions.md    # Planning decisions carried into the PR body
```

No `data-model.md`, `quickstart.md` or `contracts/` — this feature introduces no entities, no user-facing workflow and
no interface contract. Creating empty ones would violate Principle V.

### Source Code (repository root)

```text
package.json             # dependency versions + new engines.node field
package-lock.json        # regenerated; the artifact that actually pins the audited tree
tests/unit/
├── ConfigWizard.test.tsx  # tick() helper adapted to ink 7 escape flushing
└── ciAuditGate.test.ts    # new: guards the audit scripts and the publish gate
docs/
└── maintenance.md       # new: dependency policy, Node floor, deferred upgrades, what the release gate blocks
README.md                # dev-setup Node prerequisite + the two audit scripts
AGENTS.md                # "Node.js LTS (18+)" corrected to 22.12+; audit note in Working Defaults
```

**Structure Decision**: No structural change. This is a maintenance feature confined to the manifest, the lockfile, one
test helper, one new test file and documentation. `src/` is deliberately untouched (FR-010) so that a reviewer can
confirm behavioural neutrality from the diff alone. The audit gate is one `package.json` line rather than new CI
machinery, which is also what let it land at all — see Decision 8 on the `workflow` OAuth scope.

## Implementation Phases

1. **Manifest + lockfile** — bump direct dependencies, add `engines.node`, regenerate the lock, confirm
   `npm audit` and `npm audit --omit=dev` both report zero.
2. **Test adaptation** — extend `tick()` in `ConfigWizard.test.tsx` past ink's flush window, with a comment naming the
   upstream change (FR-008).
3. **Verification** — `npm run build`, `npm test`, `npm run lint`, `npm run typecheck`; confirm the test count still
   reads 668/668 with no skips.
4. **Documentation** — add `docs/maintenance.md`, correct the Node claim in `AGENTS.md`, add the prerequisite to the
   README dev-setup section, and link the new page from the README command table area per the documentation convention.
5. **Publish-time audit gate** (converge pass) — add the `audit:prod` / `audit:all` npm scripts, gate `npm publish` on
   the production audit via `prepublishOnly`, guard the wiring with `tests/unit/ciAuditGate.test.ts`, and document both
   what the gate covers and the pull-request-time CI step that remains open.

## Dependency Order

Phase 1 must precede Phase 2 (the test failure only appears once ink 7 is installed). Phase 3 gates Phase 4 — the
documented Node floor and deferred-upgrade list must state what was actually verified, not what was planned. Phase 5
comes last for a substantive reason, not just sequencing: a blocking audit added before Phase 1 cleared the tree would
have failed on its first run against the 9 baseline advisories.

## Risks

| Risk | Mitigation |
|---|---|
| A major upgrade breaks behaviour no test covers | `src/` is unchanged, so any behaviour change would have to originate upstream; the wizard (the only TUI surface) has 44 dedicated tests. |
| Raising the Node floor breaks a consumer on Node 18/20 | Declared via `engines` so npm reports it at install time, and called out as a breaking change in the PR and docs. |
| `esbuild` 0.27.2 becomes vulnerable later | The lockfile pins it, and the pin is recorded in `docs/maintenance.md` as a watch item tied to tsup widening its range. Detection is Dependabot plus `npm run audit:all` — esbuild arrives through tsup, so it is dev-only and outside the release gate. |
| A production advisory reaches a published release | `prepublishOnly` runs `audit:prod`, so `npm publish` aborts at the audit before packing. Verified by forcing the audit to exit 1 and confirming the dry run stops there. |
| The gate is silently removed by a later manifest edit | `tests/unit/ciAuditGate.test.ts` fails if `prepublishOnly` disappears, points at the full tree, gains `--audit-level`, or if an audit is moved into an install- or build-time hook. Verified by mutating all four. |
| An advisory sits unnoticed until release time | The gap is real: CI runs no audit step, so there is no pull-request-time signal beyond Dependabot. Recorded as the first open item in `docs/maintenance.md`; it needs a push from a token with the `workflow` scope. |
| TypeScript 7 stays deferred indefinitely | Recorded in `docs/maintenance.md` with its exact unblocking condition (typescript-eslint publishing TS 7 support). |
