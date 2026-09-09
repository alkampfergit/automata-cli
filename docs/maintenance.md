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

Installing on Node 18 or 20 fails at install time with an engine error rather than at first run. CI builds on
`node-version: lts/*`.

> **Breaking change (from the 031 dependency refresh):** earlier releases documented Node 18+/20+. Consumers on Node 18
> or 20 must upgrade to 22.12 or newer.

## Checking the security report

```bash
npm audit             # whole tree, including dev tooling
npm audit --omit=dev  # only what ships to consumers of the package
```

Both must report `found 0 vulnerabilities`. Run `npm audit --omit=dev` as well as the plain form — most advisories in
this project land in the dev toolchain (vitest/vite/esbuild/eslint) and never reach a published artifact, and the
distinction matters when triaging urgency.

**These checks are not run by CI.** `.github/workflows/ci.yml` runs `lint`, `typecheck`, `build` and the unit tests only,
so an advisory published after this refresh will not fail a build — it surfaces as a Dependabot alert, or the next time
someone runs `npm audit` by hand. Treat the audit as a manual step in every dependency refresh until a gate exists.

## Refresh policy

1. Try `npm audit fix` first. It only moves versions within the ranges existing parents already declare, so it is the
   lowest-risk fix and frequently sufficient — it cleared all 9 advisories in the 031 refresh on its own.
2. Move direct dependencies to their latest release, majors included, gated on `npm test && npm run lint` staying green.
3. Never silence an advisory. No `--audit-level` in CI, no ignore file, and no `overrides` entry unless the advisory is
   genuinely unreachable within the parent's declared range — record the reasoning here if one is ever added.
4. Never force a resolution with `--legacy-peer-deps`. A peer conflict means a tool is running against a version it does
   not support; defer the upgrade and record it below instead.
5. Commit the regenerated `package-lock.json`. It is what pins the audited tree, and `npm ci` is what CI installs from.

## Deferred upgrades

Standing exceptions to "latest". Each names the condition that unblocks it.

### `typescript` — held at `^5.9.3`

`typescript@7.x` cannot be installed: `typescript-eslint` depends on `ts-api-utils`, whose `typescript` peer range
excludes 6.x and 7.x, so `npm install` fails with `ERESOLVE`. Installed by force, `tsc --noEmit` reports several hundred
errors because TS 7 does not resolve `@types/node` (`Cannot find name 'node:fs'`, `Cannot find namespace 'NodeJS'`).

**Unblocked when** `typescript-eslint` publishes a release declaring TypeScript 7 support. `^5.9.3` is already the newest
5.x, so nothing is available in the meantime.

### `@types/node` — held at `^25.5.0`

DefinitelyTyped tags `22.20.2` as the `latest` version of `@types/node`, so `npm outdated` does not list this package —
by npm's own reckoning the project is already ahead. Higher majors exist (26.x) but type APIs that do not exist on the
Node 24 LTS that CI runs, which invites code that compiles and then fails at runtime.

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
entry. If a future advisory lands on `0.27.2` itself, nothing in CI will catch it — it shows up as a Dependabot alert or
in a manual `npm audit`, and the pin then needs re-evaluating immediately.

## Next refresh — open items

The order to work through when the next refresh starts. Each row points at the section above that holds the detail.

| Item | Trigger | Action |
|---|---|---|
| Audit gate in CI | Any time — nothing upstream blocks it | Add an `npm audit --omit=dev` step to `.github/workflows/ci.yml` so a production advisory fails the build. Decide separately whether the full-tree audit should warn or fail, since a dev-toolchain advisory would otherwise block unrelated PRs. |
| `typescript` 5 -> 7 | `typescript-eslint` declares TypeScript 7 support | See [Deferred upgrades](#typescript--held-at-593). Expect `@types/node` resolution work alongside it. |
| `@types/node` `^25` -> next | Project's target Node line moves past what `^25` describes | See [Deferred upgrades](#typesnode--held-at-2550). Follow the Node LTS line, not the highest published version. |
| `esbuild` 0.27.2 -> current | `tsup` widens its `esbuild` range | See [Watch items](#esbuild-is-pinned-below-its-latest-release). Move it forward and delete that entry. |

## Note for test authors

`ink@7` does not deliver a bare `Esc` keypress synchronously. It holds a trailing escape byte as pending input so it can
distinguish a lone `Esc` from the start of a longer escape sequence, then flushes it after 20 ms. A test helper that only
drains microtasks will never observe the keypress. `tests/unit/ConfigWizard.test.tsx` handles this by having `tick()`
wait 30 ms of real time; reuse that helper rather than writing a new one.
