# PR Report: Dependency Refresh & Vulnerability Remediation

**Branch**: `feature/031-dependency-updates`
**Date**: 2026-09-09
**Spec**: [specs/031-update-all-npm/spec.md](../../specs/031-update-all-npm/spec.md)

## Summary

Clears all 9 open security advisories in the dependency tree (1 low, 3 moderate, 5 high — down to zero) and moves every
direct dependency to its latest publishable release. One advisory (`ws`, high, reached through `ink`) was shipping to
consumers of the published package; the other eight were confined to the dev toolchain. Three major upgrades are
included — `commander` 14→15, `ink` 6→7 and `vitest` 4→5 — which raises the project's minimum Node.js version to 22.12.
A publish-time gate now holds the result: a production advisory aborts `npm publish`, while a dev-toolchain advisory
does not block releases. No file under `src/` changed.

## What's New

- **Security posture**: `npm audit` goes from 9 advisories to 0, for both the full tree and `--omit=dev`. Nothing is
  suppressed — every advisory is resolved by moving to a fixed version. Verified against a clean `npm ci` so the result
  is reproducible from the committed lockfile rather than an artifact of incremental installs.
- **Runtime dependencies**: `commander` `^14.0.3`→`^15.0.0`, `ink` `^6.8.0`→`^7.1.1`, `react` `^19.2.4`→`^19.3.0`.
- **Dev toolchain**: `vitest` `^4.1.2`→`^5.0.0`, `eslint` `^10.1.0`→`^10.10.0`, `typescript-eslint`
  `^8.57.2`→`^8.70.0`, `prettier` `^3.8.1`→`^3.9.6`, `@types/react` `^19.2.14`→`^19.3.0`, `@types/node` to 25.9.6
  within its existing range.
- **`engines.node` declared**: `package.json` now states `>=22.12.0`. `commander@15` and `ink@7` already require Node
  22+, so the floor rose whether or not it was written down — declaring it turns an opaque runtime failure on Node 18/20
  into a clear install-time error.
- **Wizard test helper adapted to ink 7**: `ink@7` holds a bare `Esc` byte for 20 ms so it can distinguish it from the
  start of a longer escape sequence. The `tick()` helper in `ConfigWizard.test.tsx` only drained microtasks, so no
  wall-clock time passed and 11 Esc-navigation tests stopped seeing the keypress. `tick()` now also waits 30 ms of real
  time. No assertion was weakened and no test was skipped or removed — this models the new upstream behaviour.
- **Release gate on production advisories**: three new npm scripts — `audit:prod` (`npm audit --omit=dev`),
  `audit:all` (`npm audit`), and `prepublishOnly` wired to `audit:prod`. npm runs `prepublishOnly` first in the publish
  lifecycle, so a production advisory **aborts `npm publish` before the tarball is packed or the registry is
  contacted** — in the CI `publish` job, which runs on every push, and in a hand-run publish. Neither audit script
  passes `--audit-level`, so nothing is silenced.
- **Only `audit:prod` gates, and the asymmetry is measured.** `tsup.config.ts` marks just `commander` external, so
  `ink` and `react` are bundled into `dist/index.js` — an advisory under `dependencies` is shipped code. But 8 of the 9
  baseline advisories were dev-toolchain only, and blocking releases on those would stall unrelated work for as long as
  upstream took to publish a fix. Dev advisories stay visible via `audit:all` and Dependabot.
- **The audit stays out of install- and build-time hooks.** `npm audit` needs the registry, so `prepublish` (which
  still runs on a plain `npm install`), `prepare` and `build` would each turn an offline install or build into a
  failure unrelated to the developer's change.
- **The gate is guarded by a test**: `tests/unit/ciAuditGate.test.ts` (6 tests) asserts both scripts' exact commands,
  the absence of `--audit-level`, that `prepublishOnly` runs the production audit and not the full-tree one, and that no
  install- or build-time hook runs an audit. A gate that is one manifest line is otherwise easy to drop in an unrelated
  edit and not notice until a vulnerable release is already out.
- **`docs/maintenance.md`**: new page recording the refresh policy, the supported Node floor, the two deferred upgrades
  with their exact unblocking conditions, the `esbuild` pin as a watch item, what the release gate covers, and what CI
  still does not check — so the next refresh does not have to re-derive them.

## New Libraries / Dependencies

None. No package was added or removed; only versions changed.

## Breaking Changes

- **Minimum Node.js is now 22.12.0** (previously documented as 18+ in `AGENTS.md` and 20+ in the README). Consumers on
  Node 18 or 20 must upgrade. The floor comes from `commander@15` (`node >=22.12.0`) and `ink@7` (`node >=22`), not from
  this project's own code. The new `engines` field makes npm *report* it at install time as an `npm warn EBADENGINE`
  line; it does not refuse the install, since npm only enforces `engines` when the consumer sets `engine-strict=true` in
  their own `.npmrc`. CI already runs `node-version: lts/*` (Node 24) and needs no change.
- **Developing needs a narrower range than running: `^22.13.0 || ^24.0.0 || >=26.0.0`.** `eslint@10` declares
  `^20.19.0 || ^22.13.0 || >=24` and `vitest@5` declares `^22.12.0 || ^24.0.0 || >=26.0.0`, so Node 22.12, 23 and 25 can
  install the CLI but cannot run every development command. Documented in the README and `docs/maintenance.md`.

## Testing

- **Unit (vitest)**: full suite green — 674 tests across 27 files, with zero skips. 668 across 26 files are the
  pre-change baseline, unchanged; the 6 added are the new `ciAuditGate` file. `tests/unit/ConfigWizard.test.tsx`
  (44 tests) is the one exercising the ink 7 change directly.
- **Static analysis**: `npm run lint` and `npm run typecheck` both exit 0.
- **Build**: `npm run build` produces `dist/index.js` (142.65 KB) with no errors.
- **Security**: `npm run audit:prod` and `npm run audit:all` both report `found 0 vulnerabilities` and exit 0 — so the
  new gate passes on this branch rather than being introduced red. Re-checked after a clean
  `rm -rf node_modules && npm ci`.
- **Gate behaviour (manual)**: with `audit:prod` forced to exit 1, `npm publish --dry-run` aborts at
  `npm error command sh -c npm run audit:prod` — before packing and before the registry. `npm install --dry-run` does
  not run the hook, confirming an offline install is unaffected.
- **Mutation check (manual)**: the guard test was verified to actually guard. Deleting `prepublishOnly`, pointing it at
  `audit:all`, adding `--audit-level=high`, and adding a `prepublish` audit hook each fail the suite (2, 2, 2 and 1
  test respectively); all four mutations were reverted.
- **Regression isolation (manual)**: the 11 wizard failures were attributed to `ink` specifically by reinstalling
  `ink@6` with every other upgrade in place and confirming 44/44 passed, before diagnosing the flush timer in ink's
  `input-parser.js` / `components/App.js`.
- **Behavioural neutrality**: `git diff` confirms no file under `src/` changed, so a reviewer can establish that the CLI
  surface is untouched from the diff alone.

## Notes

- **`typescript` stays on `^5.9.3`.** `typescript@7.0.2` cannot be installed — `typescript-eslint@8.70.0` declares the
  peer range `typescript >=4.8.4 <6.1.0`, whose upper bound rejects 7.x, so `npm install` fails `ERESOLVE`. The blocker
  is that direct peer range, not `ts-api-utils@2.5.0`, which accepts 7.x via its open-ended `typescript >=4.8.4`. Forced in anyway,
  `tsc --noEmit` reports 324 errors because TS 7 does not resolve `@types/node`. Not forced with `--legacy-peer-deps`,
  which would leave the lint gate silently unreliable. `^5.9.3` is already the newest 5.x.
- **`@types/node` stays on `^25`.** DefinitelyTyped tags `22.20.2` as `latest`, so `npm outdated` lists the package
  with its "Latest" column (`22.20.2`) *behind* the installed `25.9.6` — a dist-tag quirk, not an available upgrade. 26.x would type APIs absent from the Node 24 LTS that CI runs.
- **`esbuild` resolves to 0.27.2, older than the available 0.28.2.** The advisory range is `0.27.3 - 0.28.0` and
  `tsup@8.5.1` (already the latest tsup) declares `esbuild@^0.27.0`, so 0.27.2 is the only safe version inside the range
  tsup supports. No `overrides` entry was added — forcing 0.28.x past tsup's declared range risks a bundler break for no
  security gain. Revisit when tsup widens the range.
- `npm outdated` therefore still lists two rows (`typescript`, `@types/node`); both are the documented exceptions above,
  not oversights.
- **One piece of this is blocked on a token scope, and it is the only thing I could not finish.** The gate belongs in
  `.github/workflows/ci.yml` as well, so an advisory shows up at pull-request time rather than only at publish time. I
  wrote and verified that version first, then withdrew it: GitHub rejects any push touching `.github/workflows/` from
  an OAuth token without the `workflow` scope, and mine carries `gist, read:org, repo`. The exact change is two steps at
  the end of the `build` job — `run: npm run audit:prod` (blocking) and `run: npm run audit:all` with
  `continue-on-error: true` — recorded as the first row of `docs/maintenance.md` § Next refresh. Either apply it
  yourself, or run `gh auth refresh -h github.com -s workflow` for the automation account and I will push it. The
  release path is gated meanwhile; what is missing is the earlier signal, not the protection.
- **The dev-toolchain audit is advisory by design, not by omission.** A future `vitest`/`eslint`/`tsup` advisory will
  surface via Dependabot and `npm run audit:all`, and will not block a release. If you would rather it did, point
  `prepublishOnly` at `audit:all` — the guard test then needs its matching expectation flipped, which is deliberate.
- **What is still deferred, and why none of it is actionable here.** `typescript` 5→7 waits on `typescript-eslint`
  declaring TS 7 support; `@types/node` waits on the target Node line moving past `^25`; `esbuild` 0.27.2 waits on
  `tsup` widening its range. Each is upstream-blocked, and each is recorded in `docs/maintenance.md` § Next refresh with
  its trigger. The audit gate was the only open item with nothing upstream in the way, which is why it is the one that
  landed — and it landed at the publish boundary rather than in CI for the token-scope reason above.
- Markdown files in this repo are not Prettier-formatted (all 9 pre-existing `docs/*.md` pages and the README fail
  `prettier --check`), and `tests/unit/ConfigWizard.test.tsx` already failed on `develop` before this branch. Left as-is
  so the diff stays reviewable; `npm run lint` only covers `src/` and is green.
