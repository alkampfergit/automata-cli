# Implementation Plan: Blocked-exit diagnostics for `do-work`

**Branch**: `feature/038-blocked-diagnostics` | **Date**: 2026-09-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/038-blocked-diagnostics/spec.md`

## Summary

Make a `do-work` tick that does nothing say why. Five exits that today print one line each render the same
six-section health report `--check` builds, headed by what blocked them. The report itself gains the three
facts that would have closed issue #82 on its own — where the operation log directory is and how that path
was derived, whether it is writable, and which working directory the lock's holder runs from — plus a
heartbeat so a live tick's phase and current item are visible, a `--verbose` command trace, and one
investigative command under each problem. Finally, a live lock now suppresses the "no tick has ever run"
finding, which is the contradiction the issue pasted.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode), Node.js 22.12+ to run / 24 LTS to develop

**Primary Dependencies**: commander.js (CLI), `node:child_process` `spawnSync` (git/gh), `node:fs`, ink + react (wizard)

**Storage**: `.automata/config.json` (one new boolean key), `.automata/automata.lock` (one new field),
`.automata/automata-heartbeat.json` (new, transient), the existing operation logs under `dirname(cwd)` (read only)

**Testing**: vitest — unit tests over the pure report model, command tests driving `doWorkCommand.parseAsync`

**Target Platform**: Linux/macOS host running the CLI, typically from cron

**Project Type**: single-package CLI

**Performance Goals**: the blocked dump adds no GitHub call and no `git fetch` to a tick

**Constraints**: no blocked dump, heartbeat write or trace may change stdout's existing contract, any exit
code, or whether a tick succeeded; the run-lock protocol is untouched

**Scale/Scope**: 2 new modules, 11 modified source files, 1 config key, 1 wizard screen, 3 docs pages

## Constitution Check

| Principle | Assessment |
|---|---|
| I. CLI-First Design | `--verbose` is a commander option; every addition has a `--json` shape; exit codes are explicitly unchanged. **Pass** |
| II. TypeScript Strictness | New types are explicit; no `any`; optional fields are `?`/`\| null` with the absent case meaning "written by an older automata". **Pass** |
| III. Single Responsibility | The report model stays pure in `checkReport.ts`; the heartbeat and the command trace are separate modules rather than more surface on `runLock.ts`. **Pass** |
| IV. npm Distribution | No new dependency. **Pass** |
| V. Simplicity | One new config key, asked for explicitly; the trace sink is a module-level array rather than a recorder threaded through every service. The alternative for each is recorded in `research.md`. **Pass** |

No violations to track.

## Project Structure

### Documentation (this feature)

```text
specs/038-blocked-diagnostics/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── blocked-dump.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── run/
│   ├── checkReport.ts      # MODIFIED: Problem.command, lock cwd + heartbeat rendering,
│   │                       #           always-on log-directory disclosure, live-lock suppression,
│   │                       #           the Commands appendix
│   ├── heartbeat.ts        # NEW: the token-bound sidecar — format, parse, write, read
│   ├── commandTrace.ts     # NEW: the --verbose sink
│   ├── operationLog.ts     # MODIFIED: inspectLogDirectory()
│   └── runLock.ts          # MODIFIED: LockOwner.cwd, LockHandle.heartbeat(), LockStatus.heartbeat,
│                           #           AUTOMATA_OWN_PATHS
├── git/
│   ├── repoStatus.ts       # MODIFIED: trace its git calls; exclude the heartbeat from the porcelain filter
│   ├── repoHygiene.ts      # MODIFIED: exclude the heartbeat from the dirtiness probe and the staging
│   ├── workspaceService.ts # MODIFIED: exclude the heartbeat from both branch preparations
│   └── gitService.ts       # MODIFIED: trace its git/gh calls
├── github/
│   └── ghWorkService.ts    # MODIFIED: trace its gh calls
├── config/
│   ├── githubService.ts    # MODIFIED: trace its gh calls
│   ├── configStore.ts      # MODIFIED: doWork.dumpOnBlock
│   └── ConfigWizard.tsx    # MODIFIED: the dump-on-block screen
└── commands/
    ├── doWork.ts           # MODIFIED: buildCheckReport split, the five blocked dumps,
    │                       #           --verbose, heartbeat call sites
    └── config.ts           # MODIFIED: config set do-work-dump-on-block

tests/unit/                 # checkReport, heartbeat, commandTrace, operationLog,
                            # runLock, doWorkCheck.cmd, doWork.cmd, config.cmd, ConfigWizard

docs/do-work.md             # MODIFIED: blocked dumps, heartbeat, --verbose, the config key
docs/config.md              # MODIFIED: the new key
CHANGELOG.md                # MODIFIED: ## [Unreleased]
```

**Structure Decision**: the existing single-package layout. The two new files go in `src/run/` beside
`runLock.ts` and `operationLog.ts`, which is where this repository already puts best-effort side channels —
pure format/parse functions plus one I/O entry point whose body is a silent `try`/`catch`.

## Implementation Order

1. **Pure model first** (`checkReport.ts`, `heartbeat.ts`, `commandTrace.ts`, `operationLog.ts`) — every
   acceptance scenario in the spec is a unit test over these, needing no git, no `gh` and no filesystem.
2. **Lock plumbing** (`runLock.ts`) — `cwd`, `heartbeat()`, `LockStatus.heartbeat`.
3. **Trace call sites** (four `spawnSync` wrappers) — three lines each.
4. **Command wiring** (`doWork.ts`) — split `runCheck`, add `--verbose`, add the five dumps, add the
   heartbeat call sites.
5. **Configuration** (`configStore.ts`, `config.ts`, `ConfigWizard.tsx`).
6. **Docs and changelog**.

## Complexity Tracking

No constitution violations require justification.
