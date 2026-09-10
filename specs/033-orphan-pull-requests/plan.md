# Implementation Plan: Manage orphaned pull requests in `do-work`

**Branch**: `feature/033-orphan-pull-requests` | **Date**: 2026-09-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/033-orphan-pull-requests/spec.md`

## Summary

`do-work` gains a second discovery pass, run after the issue pass and sharing its run budget, over
the open pull requests of this repository that close no issue of this repository. Candidates are
selected with the existing `issueDiscoveryTechnique` / `issueDiscoveryValue` applied to the pull
request, and a candidate becomes work under exactly the rule that already governs issues: an
authorized account has left a message the agent has not answered. The turn is a new kind,
`pr-orphan`, running on the pull request's head branch with a configurable
`doWork.prompts.prOrphan` frame, reusing the existing fork and protected-branch refusals, the
`working…` marker and its reconciliation.

## Technical Context

**Language/Version**: TypeScript 5.x, strict mode

**Primary Dependencies**: commander.js (CLI), `gh` CLI via `spawnSync` (GitHub data), ink + react
(configuration wizard) — all already present; no new dependency

**Storage**: `.automata/config.json` (one new optional key, `doWork.prompts.prOrphan`) and
`.automata/do-work-pr-orphan.md` when the wizard writes the prompt to a file

**Testing**: vitest — `tests/unit/workDetection.test.ts`, `tests/unit/workPrompt.test.ts`,
`tests/unit/ghWorkService.test.ts`, `tests/unit/doWork.cmd.test.ts`,
`tests/unit/configStore.test.ts`, `tests/unit/config.cmd.test.ts`,
`tests/unit/ConfigWizard.test.tsx`

**Target Platform**: Node.js 22.12+ CLI on Linux/macOS

**Project Type**: single-project CLI

**Performance Goals**: no additional GitHub API call when no orphan pull request matches the filter;
one `gh pr view` plus its paged review-thread query per *matching* candidate, which is the same cost
the issue pass already pays per linked pull request

**Constraints**: the answer boundary must stay stateless and idempotent — no local state, no
head-SHA tracking; a pull request must be reachable through exactly one of the two passes

**Scale/Scope**: ~9 source files touched, 1 new turn kind, 1 new config key, 1 new CLI option, no
new module

## Constitution Check

*GATE: passed before Phase 0 and re-checked after Phase 1 design.*

| Principle | Assessment |
|---|---|
| I. CLI-First Design | `--pr <number>` is a commander option beside `--issue`; the orphan pass reports through the same human-readable plan/summary and the same `--json` payload; exit codes unchanged. **Pass.** |
| II. TypeScript Strictness | No `any`. `WorkItem.issue` becomes an explicit `GitHubIssue \| null`; the two new skip reasons extend a literal union; `Decision`'s skip variant gains an explicit `pr: PullRequestRef \| null`. **Pass.** |
| III. Single Responsibility | Discovery stays in `ghWorkService.ts` (it owns the `gh` runner), the decision stays in `workDetection.ts` (pure, no I/O), prompt assembly stays in `workPrompt.ts`, orchestration stays in `commands/doWork.ts`. No logic is duplicated: `processItem`, the marker reconciliation and the run-cap accounting are shared by all three turn kinds. **Pass.** |
| IV. npm Distribution | No new dependency, no bundler change. **Pass.** |
| V. Simplicity | No new module and no new abstraction layer: one nullable field, one decision function beside the existing one, one wrapper interface at the discovery boundary. The alternatives that *would* have added indirection (a `subject` union, a second processing pipeline) are recorded as rejected in `research.md`. **Pass.** |

No violations, so Complexity Tracking is omitted.

## Project Structure

### Documentation (this feature)

```text
specs/033-orphan-pull-requests/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── spec.md
├── tasks.md             # Phase 2 output (/speckit-tasks)
├── pr-report.md
└── spec-decisions.md
```

No `contracts/` directory: the feature exposes no HTTP or wire contract. Its observable contracts are
the CLI surface and the `--json` payload, both captured in `quickstart.md` and `data-model.md`.

### Source Code (repository root)

```text
src/
├── config/
│   ├── configStore.ts        # TurnKind += "pr-orphan"; DoWorkPrompts.prOrphan;
│   │                         #   DEFAULT_DO_WORK_PR_ORPHAN_PROMPT; resolvePromptRef wiring
│   └── ConfigWizard.tsx      # Prompts → "Do Work — Orphan PR" screen (appended last)
├── commands/
│   ├── config.ts             # VALID_TURN_KINDS += "pr-orphan"; do-work-prompt dispatch
│   └── doWork.ts             # --pr option; orphan discovery + filter; second pass sharing the
│                             #   run budget; report/plan/JSON labelling; refresh for orphans
├── github/
│   ├── ghWorkService.ts      # LINK_MAP_QUERY += labels/assignees; OpenPrLinkMap.orphans
│   ├── workDetection.ts      # WorkItem.issue nullable; decideOrphanPrWork; skip reasons
│   └── workPrompt.ts         # issue sections conditional on item.issue

tests/unit/
├── ghWorkService.test.ts     # orphan extraction from the link map
├── workDetection.test.ts     # the orphan decision table
├── workPrompt.test.ts        # the orphan prompt shape
├── doWork.cmd.test.ts        # the second pass, the shared cap, --pr, --json, --dry-run
├── configStore.test.ts       # prOrphan file resolution
├── config.cmd.test.ts        # config set do-work-prompt pr-orphan
└── ConfigWizard.test.tsx     # the new prompts screen

docs/
├── do-work.md                # the authoritative reference for this command group
└── config.md                 # doWork.prompts.prOrphan
docs/wiki/Detection-Rules.md  # the orphan trigger rule
```

**Structure Decision**: the existing flat module layout is kept exactly as it is — discovery in
`src/github/ghWorkService.ts` (the only module holding the private `spawnSync` runner), pure
decision logic in `src/github/workDetection.ts`, prompt text assembly in
`src/github/workPrompt.ts`, orchestration in `src/commands/doWork.ts`. No new directory and no new
module is introduced: each piece of this feature has an existing home whose stated responsibility
covers it, and project memory records that splitting I/O wrappers from decision logic this way is
what keeps the rules unit-testable without a `gh` binary.

## Phase 1 design outputs

- [data-model.md](data-model.md) — the changed and new types, and the `--json` shape.
- [quickstart.md](quickstart.md) — the operator-facing walkthrough used to validate the feature.

## Implementation order (dependency order)

1. `configStore.ts` — the turn kind and the prompt key, since every other file references them.
2. `ghWorkService.ts` — the extended query and `OpenPrLinkMap.orphans`.
3. `workDetection.ts` — the nullable issue, `decideOrphanPrWork`, the new skip reasons.
4. `workPrompt.ts` — the conditional issue sections.
5. `commands/doWork.ts` — `--pr`, the filter, the second pass, the reporting.
6. `commands/config.ts` and `ConfigWizard.tsx` — the two configuration surfaces.
7. Docs.

Tests are written alongside each step (the repo's convention is one unit-test file per module), and
the whole suite plus `npm run lint` is the gate before the PR.
