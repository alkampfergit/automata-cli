# PR Report: Dependency Refresh & Vulnerability Remediation

**Branch**: `feature/031-dependency-updates`
**Date**: 2026-09-09
**Spec**: [specs/031-update-all-npm/spec.md](../../specs/031-update-all-npm/spec.md)

## Summary

Clears all 9 open security advisories in the dependency tree (1 low, 3 moderate, 5 high — down to zero) and moves every
direct dependency to its latest publishable release. One advisory (`ws`, high, reached through `ink`) was shipping to
consumers of the published package; the other eight were confined to the dev toolchain. Three major upgrades are
included — `commander` 14→15, `ink` 6→7 and `vitest` 4→5 — which raises the project's minimum Node.js version to 22.12.
No file under `src/` changed.

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
- **`docs/maintenance.md`**: new page recording the refresh policy, the supported Node floor, the two deferred upgrades
  with their exact unblocking conditions, and the `esbuild` pin as a watch item — so the next refresh does not have to
  re-derive them.

## New Libraries / Dependencies

None. No package was added or removed; only versions changed.

## Breaking Changes

- **Minimum Node.js is now 22.12.0** (previously documented as 18+ in `AGENTS.md` and 20+ in the README). Consumers on
  Node 18 or 20 must upgrade. The floor comes from `commander@15` (`node >=22.12.0`) and `ink@7` (`node >=22`), not from
  this project's own code. It is enforced by the new `engines` field, so npm reports it at install time. CI already runs
  `node-version: lts/*` (Node 24) and needs no change.

## Testing

- **Unit (vitest)**: full suite green — 668 tests across 26 files, the same count as the pre-change baseline, with zero
  skips. `tests/unit/ConfigWizard.test.tsx` (44 tests) is the one exercising the ink 7 change directly.
- **Static analysis**: `npm run lint` and `npm run typecheck` both exit 0.
- **Build**: `npm run build` produces `dist/index.js` (142.65 KB) with no errors.
- **Security**: `npm audit` and `npm audit --omit=dev` both report `found 0 vulnerabilities`, re-checked after a clean
  `rm -rf node_modules && npm ci`.
- **Regression isolation (manual)**: the 11 wizard failures were attributed to `ink` specifically by reinstalling
  `ink@6` with every other upgrade in place and confirming 44/44 passed, before diagnosing the flush timer in ink's
  `input-parser.js` / `components/App.js`.
- **Behavioural neutrality**: `git diff` confirms no file under `src/` changed, so a reviewer can establish that the CLI
  surface is untouched from the diff alone.

## Notes

- **`typescript` stays on `^5.9.3`.** `typescript@7.0.2` cannot be installed — `typescript-eslint@8.70.0` pulls
  `ts-api-utils@2.5.0`, whose `typescript` peer range rejects 7.x, so `npm install` fails `ERESOLVE`. Forced in anyway,
  `tsc --noEmit` reports 324 errors because TS 7 does not resolve `@types/node`. Not forced with `--legacy-peer-deps`,
  which would leave the lint gate silently unreliable. `^5.9.3` is already the newest 5.x.
- **`@types/node` stays on `^25`.** DefinitelyTyped tags `22.20.2` as `latest`, so `npm outdated`'s "Latest" column is
  *behind* what the repo already declares. 26.x would type APIs absent from the Node 24 LTS that CI runs.
- **`esbuild` resolves to 0.27.2, older than the available 0.28.2.** The advisory range is `0.27.3 - 0.28.0` and
  `tsup@8.5.1` (already the latest tsup) declares `esbuild@^0.27.0`, so 0.27.2 is the only safe version inside the range
  tsup supports. No `overrides` entry was added — forcing 0.28.x past tsup's declared range risks a bundler break for no
  security gain. Revisit when tsup widens the range.
- `npm outdated` therefore still lists two rows (`typescript`, `@types/node`); both are the documented exceptions above,
  not oversights.
- Markdown files in this repo are not Prettier-formatted (all 9 pre-existing `docs/*.md` pages and the README fail
  `prettier --check`), and `tests/unit/ConfigWizard.test.tsx` already failed on `develop` before this branch. Left as-is
  so the diff stays reviewable; `npm run lint` only covers `src/` and is green.
