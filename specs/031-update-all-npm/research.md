# Phase 0 Research: Dependency Refresh & Vulnerability Remediation

**Branch**: `feature/031-dependency-updates` | **Date**: 2026-09-09

All findings below were produced by running the named commands against this repository on Node v24.21.0 / npm 11.19.0.

## Baseline

`npm audit` against the committed `package-lock.json` on `develop`:

```
9 vulnerabilities (1 low, 3 moderate, 5 high)
```

| Package | Severity | Reaches production? | Path |
|---|---|---|---|
| `ws` | high | **yes** | `ink` -> `ws` |
| `vite` | high | no (dev) | `vitest` -> `vite` |
| `postcss` | high | no (dev) | `vitest` -> `vite` -> `postcss` |
| `brace-expansion` | high | no (dev) | `eslint` |
| `esbuild` | moderate | no (dev) | `tsup`, `vite` |
| `@vitest/mocker` | moderate | no (dev) | `vitest` |
| `@humanfs/node` | moderate | no (dev) | `eslint` |
| `nanoid` | low | no (dev) | `vitest` -> `vite` |

`npm audit --omit=dev` reports exactly one high (`ws`), so only one advisory is shipped to consumers.
Baseline test state: `npm test` -> 26 files, 668 tests, all passing.

## Decision 1 — Remediation mechanism

**Decision**: Upgrade to fixed versions and regenerate `package-lock.json`. Do not add `overrides`, do not suppress.

**Rationale**: `npm audit fix` (which only moves versions inside ranges the existing parents already declare) takes the
tree from 9 advisories to 0 with **no change to `package.json` at all** — the entire baseline is reachable without
forcing anything. Verified: `npm audit fix` -> `found 0 vulnerabilities`, diff limited to `package-lock.json`.

**Alternatives considered**:

- *`overrides` block* — rejected: unnecessary, since no advisory needed a version outside its parent's declared range.
  An override also silently detaches the tree from what upstream tests against.
- *`--audit-level=high` in CI / ignore file* — rejected: hides the problem rather than fixing it, and directly
  contradicts the issue's request.

## Decision 2 — How far to move direct dependencies

**Decision**: Move every direct dependency to its latest published release, including majors, gated on the full suite
staying green. Two exceptions, below.

**Rationale**: The issue asks for "the latest version of libraries". `commander`, `ink` and `vitest` each have only a
major step available, so a minor-only policy would leave the request unmet. The 668-test suite plus `tsc --noEmit` and
`eslint` is a strong enough gate to make majors verifiable rather than speculative.

Resulting moves:

| Package | From | To | Kind |
|---|---|---|---|
| `commander` | ^14.0.3 | ^15.0.0 | major |
| `ink` | ^6.8.0 | ^7.1.1 | major |
| `react` | ^19.2.4 | ^19.3.0 | minor |
| `@types/react` | ^19.2.14 | ^19.3.0 | minor |
| `eslint` | ^10.1.0 | ^10.10.0 | minor |
| `prettier` | ^3.8.1 | ^3.9.6 | minor |
| `typescript-eslint` | ^8.57.2 | ^8.70.0 | minor |
| `vitest` | ^4.1.2 | ^5.0.0 | major |
| `@eslint/js`, `tsup`, `ink-testing-library`, `typescript` | — | unchanged | already latest in their line |

**Alternatives considered**:

- *Patch/minor only* — rejected: leaves `commander`, `ink`, `vitest` behind and does not satisfy the issue.
- *Upgrade only the packages named in an advisory* — rejected: satisfies P1 but not P2, and leaves the next refresh
  larger.

## Decision 3 — TypeScript stays on 5.x

**Decision**: Keep `typescript` at `^5.9.3`. Defer `typescript@7.0.2`.

**Rationale**: Installing `typescript@7.0.2` fails resolution:

```
npm error code ERESOLVE
npm error While resolving: typescript-eslint@8.70.0
npm error   peer typescript@">=4.8.4" from ts-api-utils@2.5.0
```

Installed anyway (via a separate step), `tsc --noEmit` produced **324 errors** — TS 7 could not resolve `@types/node`
at all (`error TS2591: Cannot find name 'node:fs'`, `error TS2503: Cannot find namespace 'NodeJS'`). `^5.9.3` is already
the newest 5.x release, so no in-line upgrade is available either.

**Alternatives considered**:

- *Force with `--legacy-peer-deps`* — rejected: leaves `typescript-eslint` running against an unsupported compiler, so
  `npm run lint` becomes unreliable while still reporting success.
- *Drop `typescript-eslint` to unblock TS 7* — rejected: far outside the scope of a dependency refresh and would
  weaken the lint gate the constitution requires.

## Decision 4 — `@types/node` stays on `^25.5.0`

**Decision**: Leave `@types/node` at `^25.5.0`.

**Rationale**: DefinitelyTyped tags `22.20.2` as `latest` for `@types/node`, so by npm's own definition the repo is
already ahead of "latest"; `npm outdated` does not list it. The highest published version is `26.5.1`, which types APIs
absent from the Node 24 LTS that CI runs (`node-version: lts/*`), inviting code that compiles and then fails at runtime.
It carries no advisory and is a devDependency.

**Alternatives considered**:

- *Bump to `^26.5.1`* — rejected: chases a number at the cost of type accuracy against the actual runtime.
- *Drop to `^24` to match Node 24* — rejected: a downgrade the issue did not ask for, and `^25` typechecks clean today.

## Decision 5 — `esbuild` resolves to 0.27.2 (a downgrade)

**Decision**: Accept `esbuild@0.27.2` as pinned by the regenerated lockfile. Add no `overrides` entry.

**Rationale**: The advisory range is `0.27.3 - 0.28.0`. `tsup@8.5.1` declares `esbuild@^0.27.0`, so the only
non-vulnerable version reachable inside that range is `0.27.2`. The fixed `0.28.2` exists but sits outside `^0.27.0`.
`tsup@8.5.1` is already the latest tsup, so this is an upstream constraint, not a stale-version problem. The committed
lockfile is what holds the pin, and `npm ci` is what CI uses.

**Alternatives considered**:

- *`"overrides": { "esbuild": "^0.28.2" }`* — rejected: forces the bundler and Vite past the range they declare support
  for, risking a build break for zero security gain — 0.27.2 predates the vulnerable window entirely.
- *Wait for a tsup release that widens the range* — rejected: blocks the security fix on an upstream release.

## Decision 6 — `ink@7` changes ESC key delivery

**Decision**: Adapt the wizard test helper to wait past ink's escape-flush window. Do not pin `ink@6`.

**Rationale**: Upgrading to `ink@7` failed 11 of the 44 `ConfigWizard` tests, all of them Esc-to-go-back navigation.
Isolated by reinstalling `ink@6` with every other upgrade in place: 44/44 passed, confirming `ink` as the sole cause.

Root cause, from `node_modules/ink/build/input-parser.js` and `components/App.js`: ink 7 treats a trailing ESC byte as
*pending* input rather than a keypress, so it can tell a bare Esc apart from the start of a longer escape sequence, and
flushes it after `pendingInputFlushDelayMilliseconds = 20`. The test's `tick()` helper only awaited three `setImmediate`
turns, so no wall-clock time passed and the flush timer never fired. Key parsing itself is unchanged — `parseKeypress`
still maps a lone ESC byte to `{name: 'escape'}`.

**Fix**: append a 30 ms real-time wait to `tick()`. Verified: 44/44 pass on `ink@7`, and the change is inert on `ink@6`.

**Alternatives considered**:

- *Pin `ink@6`* — rejected: `ws`, the only advisory reaching production, arrives through `ink`; staying on 6 works today
  but keeps the project on a line that will diverge further.
- *Fake timers in the test* — rejected: heavier than a 30 ms wait, and would have to be threaded through every existing
  `tick()` call site.
- *Relax the assertions* — rejected: forbidden by FR-007.

## Decision 7 — Node.js floor

**Decision**: Add `"engines": { "node": ">=22.12.0" }` to `package.json`.

**Rationale**: Measured engine fields of the new majors — `commander@15.0.0`: `node >=22.12.0`; `ink@7.1.1`:
`node >=22`; `vitest@5.0.0`: `node ^22.12.0 || ^24.0.0 || >=26.0.0`. Two of those are runtime dependencies, so the real
floor rises to 22.12.0 whether it is declared or not. `AGENTS.md` currently claims "Node.js LTS (18+)", which becomes
false with this change. Declaring `engines` makes npm refuse the install with a clear message instead of failing at
first run. CI already uses `node-version: lts/*` (Node 24), so no workflow change is needed.

**Alternatives considered**:

- *Leave `engines` absent* — rejected: the floor still rises, but a Node 18 user gets an opaque syntax or runtime error
  instead of an install-time diagnostic.
- *Stay on `commander@14` / `ink@6` to preserve Node 18* — rejected: does not meet P2, and the project's own CI has not
  tested Node 18 for some time (`lts/*` has meant 20+ then 22+ then 24).

## Autonomous Decisions

Every decision on this page was made without user input, per the `speckit-full` autonomous rule. Decisions 3, 4, 5 and 7
are the ones that shape the deliverable most and are carried into `spec-decisions.md` and the PR body verbatim.
