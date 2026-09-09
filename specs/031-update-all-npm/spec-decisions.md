# Spec Decisions: Dependency Refresh & Vulnerability Remediation

**Branch**: `feature/031-dependency-updates`
**Date**: 2026-09-09
**Spec**: [specs/031-update-all-npm/spec.md](../../specs/031-update-all-npm/spec.md)
**Plan**: [specs/031-update-all-npm/plan.md](../../specs/031-update-all-npm/plan.md)
**Research**: [specs/031-update-all-npm/research.md](../../specs/031-update-all-npm/research.md)

## Planning Decisions

- **Remediation mechanism**: Upgrade to fixed versions and regenerate `package-lock.json`. **Rationale**: `npm audit fix`
  — which only moves versions inside ranges the existing parents already declare — took the tree from 9 advisories to 0
  with no `package.json` change at all, so nothing had to be forced. **Alternatives considered**: an `overrides` block
  (unnecessary, since no advisory needed a version outside its parent's range, and it detaches the tree from what
  upstream tests against); `--audit-level` in CI or an ignore file (hides the problem and contradicts the request).

- **Upgrade breadth**: Move every direct dependency to its latest release, majors included, gated on the full suite
  staying green. **Rationale**: the issue asks for "the latest version of libraries", and `commander`, `ink` and `vitest`
  each have only a major step available — a minor-only policy would leave the request unmet. The 668-test suite plus
  `tsc --noEmit` and `eslint` makes majors verifiable rather than speculative. **Alternatives considered**: patch/minor
  only (leaves three packages behind); upgrading only packages named in an advisory (meets the security goal but not the
  currency goal, and makes the next refresh larger).

- **TypeScript held at `^5.9.3`**: Defer `typescript@7.0.2`. **Rationale**: `typescript-eslint@8.70.0` declares the peer range
  `typescript >=4.8.4 <6.1.0`, whose upper bound rejects 7.x, so the install fails `ERESOLVE`. It is not
  `ts-api-utils@2.5.0`, whose peer range `typescript >=4.8.4` accepts 7.x. Forced in, `tsc
  --noEmit` produces 324 errors because TS 7 does not resolve `@types/node`. `^5.9.3` is already the newest 5.x.
  **Alternatives considered**: `--legacy-peer-deps` (leaves typescript-eslint running against an unsupported compiler,
  so lint reports success while being unreliable); dropping typescript-eslint (far outside a dependency refresh and
  weakens a gate the constitution requires).

- **`@types/node` held at `^25.5.0`**: Do not chase 26.x. **Rationale**: DefinitelyTyped tags `22.20.2` as `latest`, so
  npm already considers the repo ahead of current. `npm outdated` lists the package but shows `Latest` behind
  `Current`, so it is not flagged as behind; 26.x types APIs absent
  from the Node 24 LTS that CI runs, inviting code that compiles then fails at runtime. It carries no advisory and is a
  devDependency. **Alternatives considered**: bump to `^26.5.1` (chases a number at the cost of type accuracy against the
  real runtime); drop to `^24` to match Node 24 (a downgrade the issue did not ask for; `^25` typechecks clean).

- **Accept `esbuild@0.27.2`, a downgrade**: Let the lockfile hold the pin; add no `overrides` entry. **Rationale**: the
  advisory range is `0.27.3 - 0.28.0` and `tsup@8.5.1` — already the latest tsup — declares `esbuild@^0.27.0`, leaving
  `0.27.2` as the only non-vulnerable version inside the range tsup supports. **Alternatives considered**:
  `"overrides": { "esbuild": "^0.28.2" }` (forces the bundler past its declared support range, risking a build break for
  zero security gain, since 0.27.2 predates the vulnerable window); waiting for a tsup release that widens the range
  (blocks the security fix on an upstream release).

- **Adapt the wizard test to `ink@7` rather than pin `ink@6`**: Extend `tick()` past ink's 20 ms escape-flush window.
  **Rationale**: ink 7 deliberately holds a trailing ESC byte as pending input to distinguish a lone `Esc` from a longer
  escape sequence, flushing after `pendingInputFlushDelayMilliseconds = 20`; the helper advanced only microtasks, so the
  test was passing only because no real time elapsed. Key parsing itself is unchanged, so no source change is warranted.
  **Alternatives considered**: pin `ink@6` (but `ws` — the sole advisory reaching production — arrives through `ink`, and
  pinning defers a divergence that only grows); fake timers (heavier, and would have to be threaded through every
  existing `tick()` call site); relaxing the assertions (forbidden by FR-007).

- **Declare `engines.node: ">=22.12.0"`**: Write the floor down rather than leave it implicit. **Rationale**: measured
  engine fields — `commander@15.0.0` `>=22.12.0`, `ink@7.1.1` `>=22` — mean the real floor rises regardless; declaring it
  makes npm report a clear `EBADENGINE` warning at install time instead of failing opaquely at first run. It is a
  signal, not a gate — npm refuses the install only when the consumer sets `engine-strict=true` themselves. CI already
  uses `lts/*` (Node 24).
  **Alternatives considered**: leave `engines` absent (the floor still rises, but a Node 18 user gets an opaque error);
  stay on `commander@14`/`ink@6` to preserve Node 18 (does not meet the currency goal, and CI has not tested Node 18 for
  some time).

- **Publishing gates on the production audit**: `"prepublishOnly": "npm run audit:prod"` in `package.json`.
  **Rationale**: the refresh reaches zero advisories but nothing held it there — CI runs no audit, and `publish` runs on
  every push, so a release could go out between an advisory landing and someone noticing the Dependabot alert. npm runs
  `prepublishOnly` first in the publish lifecycle, so the audit aborts `npm publish` before packing or contacting the
  registry, for CI and for a hand-run publish alike. That only `audit:prod` gates follows from a measurement:
  `tsup.config.ts` marks only `commander` external, so `ink` and `react` are bundled into `dist/index.js` and a
  `dependencies` advisory is shipped code, whereas 8 of the 9 baseline advisories were dev-toolchain only.
  **Alternatives considered**: a step in `.github/workflows/ci.yml` (the better feedback loop and the original plan —
  written and verified, then withdrawn, because GitHub rejects pushes touching `.github/workflows/` from an OAuth token
  without the `workflow` scope; recorded as an open item rather than forced through a lower-level API, since that scope
  exists precisely to stop an app editing CI); gating on the full tree (the 8:1 baseline split means it would mostly
  block releases over packages that reach no consumer, and a gate that blocks unrelated work gets disabled rather than
  fixed); `prepublish`/`prepare`/folding it into `build` (all run offline, and `prepublish` still runs on a plain
  `npm install`, so an offline install or build would fail on registry unavailability); `--audit-level=high` as the gate
  (would pass a low or moderate production advisory silently, the exact suppression FR-002 forbids).

- **The gate is guarded by a unit test rather than by review**: `tests/unit/ciAuditGate.test.ts`, reading
  `package.json`. **Rationale**: the whole control is one manifest line, so it can be removed in an unrelated edit and
  stay unnoticed until a vulnerable version has already been published; the test also pins the two properties a reader
  is most likely to "tidy" — that the gate runs the production audit rather than the full tree, and that no
  install-time hook runs an audit. **Alternatives considered**: trusting code review (the failure mode is precisely that
  nobody notices); an integration test that actually runs `npm publish --dry-run` (needs the registry, so it would make
  the suite network-dependent — done once by hand and recorded instead).

- **Project structure**: No structural change; the feature is confined to `package.json`, `package-lock.json`, one test
  helper, one new test file and documentation, with `src/` deliberately untouched. **Rationale**: behavioural neutrality then follows from
  the diff itself, which is the cheapest thing for a reviewer to verify on a dependency PR. **Alternatives considered**:
  none — no `data-model.md`, `quickstart.md` or `contracts/` were created either, since the feature introduces no
  entities, workflow or interface contract, and empty artifacts would violate the constitution's Simplicity principle.
