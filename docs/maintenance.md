# Maintenance

Reference for keeping `automata-cli`'s dependencies current and its security report clean. This page is not a command
group — it documents the policy and the standing exceptions, so a future refresh does not have to re-derive them.

## Supported Node.js versions

`automata-cli` requires **Node.js >= 22.12.0**, declared in `package.json`:

```json
"engines": {
  "node": ">=22.12.0"
}
```

The floor is set by the runtime dependencies, not by this project's own code:

| Dependency | Declared engine |
|---|---|
| `commander@15` | `node >=22.12.0` |
| `ink@7` | `node >=22` |

**`engines` warns; it does not refuse.** Under npm's default configuration an unsatisfied `engines.node` produces an
`npm warn EBADENGINE` line and the install still succeeds — verified on npm 11.19.0. It becomes a hard error only when
the *consumer* sets `engine-strict=true` in their own `.npmrc`, which a published package cannot do on their behalf.
So the field's value here is a clear, early, machine-readable signal at install time instead of an opaque failure at
first run; it is not a gate. CI builds on `node-version: lts/*`.

> **Breaking change (from the 031 dependency refresh):** earlier releases documented Node 18+/20+. Consumers on Node 18
> or 20 must upgrade to 22.12 or newer.

### Developing is stricter than running

The 22.12 floor covers the published CLI. Contributors need a *narrower* range, because the dev toolchain declares its
own engines and they do not agree with each other:

| Dev dependency | Declared engine |
|---|---|
| `eslint@10.10.0` | `^20.19.0 \|\| ^22.13.0 \|\| >=24` |
| `vitest@5.0.0` | `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` |

Their intersection is **`^22.13.0 || ^24.0.0 || >=26.0.0`**. So three versions can install the CLI yet cannot run every
development command: Node **22.12** (runs vitest, but is below eslint's `^22.13.0`), Node **23** (excluded by both), and
Node **25** (lints, but falls in the gap between vitest's `^24.0.0` and `>=26.0.0`). CI uses
`node-version: lts/*` (Node 24), which is inside the intersection; Node 24 is the safe choice locally.

## Checking the security report

Two npm scripts, so a local check and the publish gate run exactly the same thing (CI runs neither yet — see
[What CI does not yet enforce](#what-ci-does-not-yet-enforce)):

```bash
npm run audit:prod  # npm audit --omit=dev  -> only what ships to consumers
npm run audit:all   # npm audit             -> whole tree, including dev tooling
```

Both must report `found 0 vulnerabilities`. Run `audit:prod` as well as the full form — most advisories in this project
land in the dev toolchain (vitest/vite/esbuild/eslint) and never reach a published artifact, and the distinction matters
both for triaging urgency and for what the release gate below does about it.

### The release gate

`package.json` declares:

```json
"prepublishOnly": "npm run audit:prod"
```

npm runs `prepublishOnly` first in the publish lifecycle, so **a production advisory aborts `npm publish` before the
tarball is packed or the registry is contacted**. The CI `publish` job runs `npm publish` on every push, so this gates
every release — `dev`, `next` and `latest` alike — as well as a publish run by hand.

Only `audit:prod` is gated, and the asymmetry is the point. tsup marks just `commander` as external
(`tsup.config.ts`), so `ink` and `react` are bundled straight into `dist/index.js`: an advisory under `dependencies`
is shipped code. The dev toolchain — vitest, eslint, tsup and their trees — never leaves the repository, and 8 of the 9
advisories cleared in the 031 refresh were dev-only. Blocking releases on those would stall unrelated work for as long
as upstream took to publish a fix, and a gate that blocks unrelated work gets disabled rather than fixed. Dev
advisories surface through Dependabot and `npm run audit:all` instead.

The audit is deliberately **not** wired into `build`, `prepare`, `prepublish` or any install-time hook: `npm audit`
needs the registry, so an offline build or install would fail on a network hiccup rather than on a real defect (and
`prepublish`, unlike `prepublishOnly`, still runs on a plain `npm install`).

Neither script passes `--audit-level`. The flag would not hide anything — a lower-severity advisory still appears in
the report — but it lets the command exit 0 below the chosen threshold, so a moderate advisory would sail through the
publish gate. An advisory is resolved or recorded here, never waved past.
`tests/unit/ciAuditGate.test.ts` pins all of this: the two scripts' exact commands, the absence of `--audit-level`,
that `prepublishOnly` runs the production audit and not the full-tree one, and that no install- or build-time hook runs
an audit.

### What CI does not yet enforce

`.github/workflows/ci.yml` runs `lint`, `typecheck`, `build` and the unit tests — **no audit step**. So an advisory is
caught at publish time (above) and by Dependabot, but not at pull-request time. Adding an audit step to the `build` job
would surface it earlier; see [Next refresh](#next-refresh--open-items) for the exact change and why it is still open.

## Refresh policy

1. Try `npm audit fix` first. It only moves versions within the ranges existing parents already declare, so it is the
   lowest-risk fix and frequently sufficient — it cleared all 9 advisories in the 031 refresh on its own.
2. Move direct dependencies to their latest release, majors included, gated on `npm test && npm run lint` staying green.
3. Never silence an advisory. No `--audit-level` in CI, no ignore file, and no `overrides` entry unless the advisory is
   genuinely unreachable within the parent's declared range — record the reasoning here if one is ever added.
4. Never force a resolution with `--legacy-peer-deps`. A peer conflict means a tool is running against a version it does
   not support; defer the upgrade and record it below instead.
5. Commit the regenerated `package-lock.json`. It is what pins the audited tree, and `npm ci` is what CI installs from.
6. Finish with `npm run audit:prod && npm run audit:all`. The first must exit 0 before the branch is pushed, because it
   is what blocks the release; the second may report dev-toolchain advisories, which belong in the table below rather
   than in a blocked merge.

## Deferred upgrades

Standing exceptions to "latest". Each names the condition that unblocks it.

### `typescript` — held at `^5.9.3`

`typescript@7.x` cannot be installed: `typescript-eslint@8.70.0` declares the peer range `typescript >=4.8.4 <6.1.0`,
whose upper bound rejects 7.x, so `npm install` fails with `ERESOLVE`. (The blocker is *not* `ts-api-utils@2.5.0`, whose
own peer range is the open-ended `typescript >=4.8.4` and accepts 7.x — see `package-lock.json`.)

Installed by force, `tsc --noEmit` reports several hundred
errors because TS 7 does not resolve `@types/node` (`Cannot find name 'node:fs'`, `Cannot find namespace 'NodeJS'`).

**Unblocked when** `typescript-eslint` publishes a release declaring TypeScript 7 support. `^5.9.3` is already the newest
5.x, so nothing is available in the meantime.

### `@types/node` — held at `^25.5.0`

DefinitelyTyped tags `22.20.2` as the `latest` version of `@types/node`. `npm outdated` *does* list the package, but
its "Latest" column reads `22.20.2` against a "Current" of `25.9.6` — by npm's own reckoning the project is already
ahead, so the row is not an upgrade to take. Higher majors exist (26.x) but type APIs that do not exist on the Node 24
LTS that CI runs, which invites code that compiles and then fails at runtime.

**Unblocked when** the project's target Node version moves past what `^25` describes. Track the Node LTS line, not the
highest published `@types/node`.

## Watch items

### `esbuild` is pinned below its latest release

`esbuild` resolves to **0.27.2**, which is older than the 0.28.2 available. This is deliberate:

- The advisory range is `0.27.3 - 0.28.0`.
- `tsup@8.5.1` (already the latest tsup) declares `esbuild@^0.27.0`.
- So the only non-vulnerable version reachable inside tsup's supported range is `0.27.2`.

The pin lives in `package-lock.json`. No `overrides` entry was added, because forcing `0.28.x` would push the bundler
past the range it declares support for, for no security gain — `0.27.2` predates the vulnerable window entirely.

**Revisit when** tsup widens its `esbuild` range to `^0.28.0`; at that point move `esbuild` forward and delete this
entry. A future advisory on `0.27.2` itself would surface in `npm run audit:all` and as a Dependabot alert. It would
*not* block a release — esbuild arrives through tsup, so it is dev-only and outside `audit:prod` — so the pin needs
re-evaluating as soon as either of those starts reporting it.

## Next refresh — open items

The order to work through when the next refresh starts. Each row points at the section above that holds the detail.

| Item | Trigger | Action |
|---|---|---|
| Audit step in `ci.yml` | Needs a maintainer, or a token with the `workflow` OAuth scope | Add to the end of the `build` job in `.github/workflows/ci.yml`: a `run: npm run audit:prod` step (blocking) and a `run: npm run audit:all` step with `continue-on-error: true`. This surfaces an advisory at pull-request time instead of only at publish time; the release itself is already gated by `prepublishOnly`. GitHub refuses pushes that touch `.github/workflows/` from an OAuth token without the `workflow` scope, which is why the automation could not land it. Extend `tests/unit/ciAuditGate.test.ts` with the matching assertions when it goes in. |
| `typescript` 5 -> 7 | `typescript-eslint` declares TypeScript 7 support | See [Deferred upgrades](#typescript--held-at-593). Expect `@types/node` resolution work alongside it. |
| `@types/node` `^25` -> next | Project's target Node line moves past what `^25` describes | See [Deferred upgrades](#typesnode--held-at-2550). Follow the Node LTS line, not the highest published version. |
| `esbuild` 0.27.2 -> current | `tsup` widens its `esbuild` range | See [Watch items](#esbuild-is-pinned-below-its-latest-release). Move it forward and delete that entry. |

## Note for test authors

`ink@7` does not deliver a bare `Esc` keypress synchronously. It holds a trailing escape byte as pending input so it can
distinguish a lone `Esc` from the start of a longer escape sequence, then flushes it after 20 ms. A test helper that only
drains microtasks will never observe the keypress. `tests/unit/ConfigWizard.test.tsx` handles this by having `tick()`
wait 30 ms of real time; reuse that helper rather than writing a new one.
