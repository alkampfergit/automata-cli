# Feature Specification: Dependency Refresh & Vulnerability Remediation

**Feature Branch**: `feature/031-dependency-updates`

**Created**: 2026-09-09

**Status**: Draft

**Input**: User description: "Some of the references are vulnerable, you can view from the dependabot and security information of the repository. Please update all the libraries so we can remove vulnerabilities and being up to date with the latest version of libraries." (GitHub issue #43)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A clean security report (Priority: P1)

As the maintainer of `automata-cli`, I open the repository's Dependabot / security tab (or run `npm audit`) and see zero
open advisories, so that I can publish the package without shipping or developing against known-vulnerable code.

**Why this priority**: This is the explicit ask in issue #43 and the only part with a security consequence. It is also
independently deliverable — the advisories can be cleared without touching any direct dependency version.

**Independent Test**: Run `npm audit` on a clean checkout of the branch. It must report `found 0 vulnerabilities`.
Run `npm audit --omit=dev` to confirm nothing vulnerable reaches consumers of the published package.

**Acceptance Scenarios**:

1. **Given** the branch is checked out and `npm ci` has been run, **When** `npm audit` is executed, **Then** it reports
   `found 0 vulnerabilities` and exits 0.
2. **Given** the branch is checked out, **When** `npm audit --omit=dev` is executed, **Then** it reports
   `found 0 vulnerabilities`, proving the published dependency tree is clean.
3. **Given** the pre-change baseline had 9 advisories (1 low, 3 moderate, 5 high), **When** the change is applied,
   **Then** every one of those advisories is resolved rather than suppressed or ignored.

---

### User Story 2 - Direct dependencies at their current release (Priority: P2)

As the maintainer, I want the packages this project declares in `package.json` to sit at their latest published release
so that the project stays close to upstream and the next security refresh is a small step rather than a migration.

**Why this priority**: Requested in the issue ("being up to date with the latest version of libraries") but carries no
security urgency on its own. It is deliverable independently of P1 — the advisories are already cleared by P1.

**Independent Test**: Run `npm outdated`. Every direct dependency either reports no newer version, or is documented in
the spec with the concrete upstream constraint that blocks it.

**Acceptance Scenarios**:

1. **Given** the change is applied, **When** `npm outdated` is executed, **Then** it produces no rows for direct
   dependencies except those explicitly recorded as deferred in this spec.
2. **Given** a direct dependency cannot be upgraded, **When** a reviewer reads the PR, **Then** they find the blocking
   upstream constraint named (package, version and peer range) rather than a bare "not upgraded".

---

### User Story 3 - The CLI still behaves exactly as before (Priority: P1)

As a user of `automata-cli`, I install the new version and every command, flag and interactive wizard screen behaves as
it did before the upgrade.

**Why this priority**: A dependency refresh that silently breaks the tool is worse than the vulnerabilities it fixed.
Equal in priority to P1 because it is the gate on shipping it.

**Independent Test**: `npm test && npm run lint` passes with the same test count as the pre-change baseline (668 tests
across 26 files), with no test deleted or skipped to make it pass.

**Acceptance Scenarios**:

1. **Given** the upgraded dependencies, **When** `npm test` runs, **Then** all 668 tests pass and no test has been
   removed, skipped or weakened.
2. **Given** the upgraded dependencies, **When** `npm run lint` and `npm run typecheck` run, **Then** both exit 0.
3. **Given** the upgraded dependencies, **When** `npm run build` runs, **Then** tsup produces `dist/index.js` with no
   errors.
4. **Given** a major upgrade changes observable library behaviour, **When** a test is adjusted, **Then** the adjustment
   models the new upstream behaviour rather than relaxing the assertion.

---

### User Story 4 - The report stays clean after the refresh (Priority: P3)

As the maintainer, I want the pipeline itself to refuse a release whose shipped dependencies carry a known advisory, so
that the zero-advisory state this feature reaches is held rather than re-earned by hand at the next refresh.

**Why this priority**: P3 because it prevents regression rather than fixing anything currently broken — the tree is
already clean once US1 lands. It is deliberately last: a gate added before the tree was clean would have failed on
day one and been reverted.

**Independent Test**: Run `npm publish --dry-run` with a failing production audit and confirm it aborts at the audit
before packing. Run it with a clean audit and confirm the audit passes and publishing proceeds to its normal next step.

**Acceptance Scenarios**:

1. **Given** a published advisory against a package under `dependencies`, **When** `npm publish` runs — in CI or by
   hand — **Then** it aborts at the audit, before the tarball is packed or the registry is contacted.
2. **Given** a published advisory confined to `devDependencies`, **When** `npm publish` runs, **Then** it is not
   blocked, so a toolchain advisory with no available fix does not stall unrelated releases.
3. **Given** the gate exists, **When** someone removes it, points it at the full tree, adds `--audit-level`, or moves
   the audit to an install-time hook, **Then** the unit suite fails.

---

### Edge Cases

- **A transitive package's only non-vulnerable version is older than the one currently installed.** This is the case for
  `esbuild`: `tsup@8.5.1` caps it at `^0.27.0` and versions `0.27.3 – 0.28.0` are vulnerable, so the sole safe in-range
  version is `0.27.2` — a downgrade. The committed lockfile is what pins it; no `overrides` entry is added, because an
  override would force `esbuild@0.28.x` past the range tsup declares it supports.
- **A major upgrade raises the minimum Node.js version.** `commander@15` requires Node `>=22.12.0` and `ink@7` requires
  Node `>=22`, whereas `AGENTS.md` currently claims Node 18+. Installing on Node 18 or 20 would fail at runtime with no
  useful message, so the requirement is declared explicitly instead of left implicit.
- **A latest release is rejected by another package's peer range.** `typescript@7.0.2` cannot be installed because
  `typescript-eslint@8.70.0` depends on `ts-api-utils` whose `typescript` peer range excludes 6.x and 7.x. The upgrade is
  deferred rather than forced with `--legacy-peer-deps`, which would leave linting silently broken.
- **A package's `latest` dist-tag is behind the highest published version.** `@types/node` publishes `26.5.1` but tags
  `22.20.2` as `latest`; the repo already declares `^25.5.0`. Chasing the highest number would type Node APIs that do not
  exist on the Node 24 LTS the CI targets.
- **An advisory that cannot be blocked on.** A dev-toolchain advisory frequently has no fixed version for days. Blocking
  releases on it would stall unrelated work in the meantime for a package that never reaches a consumer, so only the
  production audit gates publishing; the full-tree audit reports.
- **The gate cannot be installed where it belongs.** A CI workflow step would give pull-request-time feedback, but any
  push touching `.github/workflows/` requires the `workflow` OAuth scope, which the automation's token does not carry.
  The gate is placed where it can be enforced without that scope, and the workflow step is recorded as an open item.
- **A test passes only because no real time elapses.** `ink@7` holds a bare `ESC` byte for 20 ms to distinguish it from
  the start of a longer escape sequence. A test helper that only drains microtasks never observes the keypress.

## Clarifications

### Session 2026-09-09 (autonomous)

- Q: Does "update all the libraries" mean only the vulnerable ones, or every declared dependency? → A: Every declared
  dependency, with vulnerability removal as the P1 slice and "latest release" as the P2 slice. [AUTO: the issue text asks
  for both outcomes explicitly — "remove vulnerabilities" and "being up to date with the latest version of libraries" —
  so splitting them into two independently shippable stories satisfies both without conflating them.]
- Q: Are major version bumps in scope, or only patch/minor? → A: Majors are in scope, gated on the full suite staying
  green. [AUTO: `commander`, `ink` and `vitest` each have only a major available, so a minor-only reading would leave the
  P2 goal unmet; the 668-test suite is the safety net that makes majors verifiable.]
- Q: Is raising the minimum Node.js version an acceptable consequence? → A: Yes, declared explicitly via `engines.node`
  and documented as breaking. [AUTO: `commander@15` and `ink@7` already require Node >= 22, so the floor rises whether or
  not it is declared; declaring it converts a confusing runtime failure into a clear install-time one.]
- Q: What should happen when a package's latest release cannot be installed? → A: Defer it and record the blocking
  constraint in the spec and PR. [AUTO: matches the constitution's Simplicity principle — do not force a resolution with
  `--legacy-peer-deps` that leaves tooling silently broken.]
- Q: Should the CLI's own behaviour change at all? → A: No. [AUTO: the constitution treats commands as the public
  contract, and the issue is purely maintenance; behaviour drift would make the PR unreviewable.]

### Session 2026-09-09 (autonomous, converge pass)

- Q: Should CI gate on `npm audit`, given the refresh leaves the tree clean but nothing stops it drifting back? → A:
  Yes — a blocking production audit plus a non-blocking full-tree audit. [AUTO: the maintainer asked to "finish
  implementation" and this was the only open item with no upstream blocker; the split is what makes a blocking gate
  survivable, since `dependencies` are bundled into `dist/` by tsup and must never ship vulnerable, while a
  dev-toolchain advisory ships to nobody and would otherwise block unrelated PRs until upstream fixes it.]
- Q: Where should the gate live — a step in `.github/workflows/ci.yml`, or the npm publish lifecycle? → A:
  `prepublishOnly` in `package.json`. [AUTO: a workflow step gives earlier feedback, but the automation's OAuth token
  carries `gist, read:org, repo` and GitHub refuses any push touching `.github/workflows/` without the `workflow`
  scope, so it could not land it. `prepublishOnly` protects the outcome that actually matters — no vulnerable version
  reaches the registry — is enforced by npm rather than by CI configuration, and covers a hand-run `npm publish` too.
  The workflow step is recorded as an open item for a maintainer.]
- Q: Which lifecycle hook? → A: `prepublishOnly`, not `prepublish`, `prepare` or `build`. [AUTO: `npm audit` needs the
  registry; `prepublish` still runs on a plain `npm install` and `prepare`/`build` run offline, so any of those would
  fail a developer's offline install or build on a network hiccup rather than on a real defect. `prepublishOnly` runs
  only on publish, and first in that lifecycle, so it aborts before the tarball is packed.]
- Q: Raw commands in the workflow, or npm scripts? → A: `audit:prod` and `audit:all` scripts. [AUTO: every other CI
  step calls an npm script, and a script is what makes the gate reproducible locally — a maintainer runs the identical
  command CI will run rather than a remembered flag.]

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The dependency tree MUST contain zero packages with a known advisory — `npm audit` MUST report
  `found 0 vulnerabilities` for both the full tree and `--omit=dev`.
- **FR-002**: Every one of the 9 baseline advisories MUST be resolved by moving to a fixed version. Advisories MUST NOT
  be silenced via `npm audit --audit-level`, an ignore file, or an unreviewed `overrides` entry.
- **FR-003**: Direct dependencies declared in `package.json` MUST be moved to their latest published release, except
  where an upstream peer/engine constraint blocks it.
- **FR-004**: Each deferred upgrade MUST be recorded in this spec together with the concrete blocking constraint —
  package name, version, and the range that rejects it.
- **FR-005**: The committed `package-lock.json` MUST be regenerated so a fresh `npm ci` reproduces the audited tree.
- **FR-006**: `package.json` MUST declare an `engines.node` floor matching the strictest runtime requirement among its
  runtime dependencies, so an unsupported Node version fails at install time rather than at first run.
- **FR-007**: All existing tests MUST continue to pass. No test may be deleted, skipped, or have an assertion weakened
  in order to accommodate an upgrade.
- **FR-008**: Where a major upgrade changes observable library behaviour, the test suite MUST be adapted to model the new
  behaviour, and the adaptation MUST carry a comment naming the upstream change.
- **FR-009**: `npm run lint`, `npm run typecheck` and `npm run build` MUST all exit 0 after the upgrade.
- **FR-010**: No file under `src/` may change behaviour as part of this feature; source edits are permitted only where a
  library's API genuinely changed.
- **FR-011**: The raised Node.js floor MUST be documented as a breaking change for consumers in the project docs.
- **FR-012**: Publishing MUST fail when a package reachable from `dependencies` carries a known advisory, and MUST do so
  before the tarball is packed or the registry is contacted. This MUST hold for a publish run by CI and by hand.
- **FR-013**: An advisory confined to `devDependencies` MUST NOT block publishing, so a dev-toolchain advisory with no
  available fix does not stall unrelated work. Such advisories remain visible through `audit:all` and Dependabot.
- **FR-013a**: The audit MUST NOT run in any install-time or build-time script, so an offline install or build does not
  fail on registry unavailability.
- **FR-014**: Both audits MUST be exposed as npm scripts invoked identically by the gate and by a maintainer locally,
  and neither may pass `--audit-level` (which would let a lower-severity advisory through unreported, contradicting
  FR-002).
- **FR-015**: The gate's wiring MUST be covered by the unit suite — which audit it runs, that it is not the full-tree
  one, and that no install- or build-time hook runs an audit — so it cannot be removed or weakened by an unrelated
  manifest edit without a test failing.

### Key Entities

- **Advisory**: A published vulnerability report against a package version range, identified by a GHSA id and carrying a
  severity. Baseline set: 9 advisories across `@humanfs/node`, `@vitest/mocker`, `brace-expansion`, `esbuild`, `nanoid`,
  `postcss`, `vite` and `ws`.
- **Direct dependency**: A package named in `package.json` under `dependencies` or `devDependencies`. These are the only
  versions this project controls directly.
- **Transitive dependency**: A package pulled in by a direct dependency. Its version is chosen by the resolver within the
  range its parent declares, and is fixed in place by the lockfile.
- **Lockfile**: `package-lock.json` — the record that makes the audited tree reproducible for `npm ci` and CI.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `npm audit` reports 0 vulnerabilities, down from 9 (1 low, 3 moderate, 5 high).
- **SC-002**: `npm audit --omit=dev` reports 0 vulnerabilities, down from 1 high (`ws`, reached via `ink`).
- **SC-003**: 668 tests across 26 files pass — the same count as the pre-change baseline, with zero skips.
- **SC-004**: `npm run lint`, `npm run typecheck` and `npm run build` each exit 0.
- **SC-005**: `npm outdated` lists no upgradable direct dependency other than those recorded as deferred here.
- **SC-006**: Exactly one deferred upgrade is carried (`typescript`), and its blocker is named in the PR.
- **SC-007**: `npm run audit:prod` and `npm run audit:all` both exit 0 on the branch; a failing production audit aborts
  `npm publish` at the audit step; and removing the gate, pointing it at the full tree, adding `--audit-level`, or
  moving the audit to an install-time hook each fail the unit suite.

## Assumptions

- [AUTO] **Remediation strategy**: chose "upgrade to fixed versions and regenerate the lockfile" over adding `overrides`
  or suppressing advisories, because every one of the 9 advisories has a fix reachable inside the ranges the project's
  parents already declare, so no override is needed.
- [AUTO] **TypeScript stays on 5.x**: chose `^5.9.3` (the latest 5.x) over `^7.0.2`, because `typescript-eslint@8.70.0`
  pulls `ts-api-utils@2.5.0` whose `typescript` peer range rejects 7.x — installing it fails `ERESOLVE`, and forcing it
  would break `npm run lint`. Revisit when typescript-eslint ships TS 7 support.
- [AUTO] **`@types/node` stays on `^25.5.0`**: chose to leave it rather than move to `26.5.1`, because DefinitelyTyped
  tags `22.20.2` as `latest` (so npm already considers `^25` ahead of current), and 26.x describes APIs absent from the
  Node 24 LTS that CI runs. It is a devDependency with no advisory against it.
- [AUTO] **Node floor declared as `>=22.12.0`**: chose the strictest floor among runtime dependencies
  (`commander@15` needs `>=22.12.0`, `ink@7` needs `>=22`) over keeping the Node 18 claim, because the 18/20 claim is
  already false once those majors are installed, and an undeclared floor fails confusingly at runtime.
- [AUTO] **Accept the `esbuild` downgrade to `0.27.2`**: chose the lockfile pin over an `overrides` entry, because
  `tsup@8.5.1` declares `esbuild@^0.27.0` and forcing `0.28.x` past that range risks a bundler break for no security
  gain — `0.27.2` predates the vulnerable `0.27.3 – 0.28.0` window.
- [AUTO] **Adapt the wizard test to `ink@7` rather than pin `ink@6`**: chose to make the test helper wait past ink's 20 ms
  escape-disambiguation window, because the ESC buffering is deliberate upstream behaviour and the test was only ever
  passing because it advanced no real time.
- [AUTO] **No new commands, flags or config keys**: the issue asks only for a dependency refresh, so scope is limited to
  `package.json`, `package-lock.json`, test-helper adaptation, the publish-time audit gate and documentation. No CLI
  surface changes.
- [AUTO] **Production advisories block, dev advisories warn**: chose the asymmetric gate over failing on the full tree,
  because tsup bundles `ink` and `react` into `dist/` so a `dependencies` advisory is shipped code, while a toolchain
  advisory reaches no consumer and often has no fix available for days — failing on it would stall unrelated pull
  requests for no security gain.
- [AUTO] **Gate lives in the npm publish lifecycle, not the CI workflow**: chose `prepublishOnly` over a step in
  `.github/workflows/ci.yml`, because the automation's OAuth token lacks the `workflow` scope GitHub requires for any
  push touching `.github/workflows/`, so the workflow step could not be delivered. `prepublishOnly` enforces the
  outcome that matters — no vulnerable version reaches the registry — through npm rather than CI configuration, and
  also covers a publish run by hand. The workflow step remains an open item for a maintainer, recorded in
  `docs/maintenance.md`.
- [AUTO] **`prepublishOnly`, not `prepublish`/`prepare`/`build`**: chose the publish-only hook because `npm audit`
  needs the registry, and the alternatives run during a plain `npm install` or an offline build — which would fail on
  network unavailability rather than on a real defect.
- [AUTO] **The gate is guarded by a unit test**: chose `tests/unit/ciAuditGate.test.ts` over trusting review, because a
  security gate that is one `package.json` line can be dropped in an unrelated manifest edit and stay unnoticed until a
  vulnerable version has already been published.
- The GitHub Dependabot alert set is assumed to match what `npm audit` reports against the committed lockfile; `npm audit`
  is used as the checkable proxy since it can be run and verified locally and in CI.
- CI runs `node-version: lts/*` (currently Node 24), so raising the floor to Node 22.12 does not require a CI change.
