# Speckit Execution Memory

Use this file for stable, reusable lessons learned from completed `speckit-full` runs.

Keep entries short. Prefer rules over narratives. Update or remove entries when the codebase or workflow changes.

## Autonomous Defaults

- **New AI-invoking command**: add it as an `execute-prompt` subcommand rather than a new top-level command whenever the shape is "gather remote context → compose configured prompt → invoke Claude/Codex". Why: `addAiOptions()` in `src/commands/executePrompt.ts` already supplies the `--with` / `--model` / `--silent` / `--push` contract, so a top-level command would duplicate it. Confirmed: 2026-09-09.
- **Configurable prompts**: every new AI prompt gets a `prompts.<name>` config key, an exported `DEFAULT_<NAME>_PROMPT`, a `resolvePromptRef()` call in `readConfig()`, and a `Prompts → <Name>` wizard screen writing `.automata/<name>-prompt.md`. Why: this is the established four-point pattern; missing any one of them makes the prompt un-editable through the documented path. Confirmed: 2026-09-09.
- **New config keys are reachable two ways**: a `automata config set <kebab-name>` subcommand *and* a wizard screen. Why: every pre-existing key is, and users are pointed at both in error messages. Confirmed: 2026-09-09.
- **"Nothing to do" is exit 0**: commands meant to be polled report no-work on stdout and exit 0 rather than failing. Why: matches `implement-next`'s "No issues found" behaviour and keeps `set -e` wrappers usable. Confirmed: 2026-09-09.
- **Remote gating**: reject only an explicit `remoteType: "azdo"` (pointing at `docs/azdo-gap.md`) and treat an absent `remoteType` as GitHub, unless the command's whole behaviour is remote-specific like `implement-next`'s discovery. Why: demanding a rarely-set key adds friction without safety. Confirmed: 2026-09-09.

- **Dependency-refresh features**: try `npm audit fix` first and check whether it clears the tree with *no* `package.json` change — in the 031 run it cleared all 9 advisories on its own, which separates "fix the vulnerabilities" from "chase latest versions" into two independently shippable slices. Why: the low-risk half can ship even if a major upgrade turns out to be blocked. Confirmed: 2026-09-09.
- **A cleanup feature ends with the gate that keeps it clean**: after a dependency refresh, add the audit gate in the
  same PR — but *last*, after the tree is already at zero. Added earlier it fails on its own baseline and gets reverted.
  Why: without it the next advisory is caught only by a Dependabot alert on the default branch, while `publish` runs on
  every push. Confirmed: 2026-09-09.
- **Gate the release with `prepublishOnly`, not a CI step**: `"prepublishOnly": "npm run audit:prod"` aborts
  `npm publish` before the tarball is packed or the registry is contacted, covers a hand-run publish as well as the CI
  `publish` job, and — decisively — needs no `workflow` OAuth scope. Verify with `npm publish --dry-run` after forcing
  the script to exit 1. Why: it survives where a workflow edit cannot land, and it protects the outcome that matters.
  Confirmed: 2026-09-09.
- **Never wire `npm audit` into `prepublish`, `prepare`, `preinstall` or `build`**: it needs the registry, and those all
  run offline — `prepublish` even runs on a plain `npm install`. Why: turns a developer's offline install or build into
  a failure unrelated to their change. `prepublishOnly` is the only publish-exclusive hook. Confirmed: 2026-09-09.
- **Split a security gate by what actually ships**: gate on `npm audit --omit=dev`; keep the full-tree `npm audit` as an
  unenforced script. Why: `tsup.config.ts` externalises only `commander`, so a `dependencies` advisory is bundled into
  `dist/` and must stop the release, while a dev-toolchain advisory (8 of the 9 in the 031 baseline) reaches no consumer
  and would block unrelated work until upstream shipped a fix. A gate that blocks unrelated work gets disabled, not
  fixed. Confirmed: 2026-09-09.
- **Never force a peer conflict**: when a latest release fails `ERESOLVE`, defer it and record the exact blocking peer range in the spec and PR rather than using `--legacy-peer-deps`. Why: forcing leaves a tool running against an unsupported version while still reporting success — `typescript@7` vs `typescript-eslint@8.70` is the live example. Confirmed: 2026-09-09.

## Implementation Patterns

- **Pure logic in its own module**: keep `gh`/`git` I/O wrappers in the existing service files (they hold the private `spawnSync` runner) and put decision/formatting logic in a sibling domain module (e.g. `src/github/issueConversation.ts`). Why: the rules become unit-testable without mocking the `gh` CLI, and duplicating the runner would violate the constitution's no-duplication rule. Confirmed: 2026-09-09.
- **`gh --json` payloads**: declare a private `Raw…` interface for the CLI shape and normalise it (flatten `author.login`, sort by `createdAt`) before returning an exported interface. Why: strict mode forbids `any`, and callers should never handle two shapes. Confirmed: 2026-09-09.
- **ISO timestamps compare as strings**: `gh` returns normalised `YYYY-MM-DDTHH:MM:SSZ`, so use `localeCompare`/`>` instead of parsing dates. Why: less code and no `NaN` failure mode. Confirmed: 2026-09-09.
- **Literal unions in object literals**: annotate `kind: "issue" as const` (or type the array) when building objects assigned to a union-typed field — `tsc` widens to `string` otherwise and `vitest` will not catch it because it does not typecheck. Why: cost a debug cycle. Confirmed: 2026-09-09.
- **Command tests mock the services, not the CLI**: `vi.mock` every module `executePrompt.ts` imports (including `src/git/gitService.js`, which is imported for the other subcommands), then `await executePromptCommand.parseAsync(["node", "execute-prompt", "<sub>", …])` and assert on the composed prompt string. Why: this is the pattern in `executePromptFixComments.cmd.test.ts` and it survives refactors of the option plumbing. Confirmed: 2026-09-09.
- **Order-sensitive side effects**: when a comment/commit must happen before the AI runs, assert it with a shared `order: string[]` pushed from both mock implementations. Why: `toHaveBeenCalled` cannot express "before". Confirmed: 2026-09-09.
- **Wizard menu additions go last**: append to `MAIN_MENU_OPTIONS` / `PROMPTS_MENU_OPTIONS` and replace the trailing `else` in the dispatch with explicit branches. Why: `tests/unit/ConfigWizard.test.tsx` navigates by counting `DOWN` presses, so inserting an entry breaks unrelated tests. Confirmed: 2026-09-09.
- **Per-item settings, not per-tick**: when a `do-work` behaviour can differ between the issues in one tick, keep the *inputs* on `Settings` and return the resolved value from a helper the call sites take as a parameter. Do **not** mutate `settings` per item: `processItem` has six early `return`s, so any of them would leak the previous item's value into the next — silent and order-dependent, on an unattended loop. Confirmed: 2026-09-10.
- **A pre-flight refusal goes *after* `postMarker`**, next to `describeOversizedPrompt`: the marker is what advances the answer boundary, so refusing before it exists re-refuses the same message on every later tick and posts a fresh comment each time. Report it `failed` and omit `ranExecutor` so the run cap is untouched. Confirmed: 2026-09-10.
- **Left-guard a `key:value` directive with a lookbehind, not `\b`**: `\b` sits between `-` and `t`, so `/\btool:/` matches `no-tool:codex`. `/(?<![A-Za-z0-9_:-])tool:/` is the one that does not, and Node 22 supports it natively. Confirmed: 2026-09-10.
- **Build a fresh `RegExp` per call from a module-level global pattern** before `matchAll`: a shared `/…/g` carries `lastIndex` across calls and returns different results on the second parse of the same string. Test for it explicitly — `expect(parse(body)).toEqual(parse(body))`. Confirmed: 2026-09-10.
- **`as const` on union-member object literals does not give TypeScript a discriminant**: `"execution" in entry` narrowing failed across a `.map()` result. Declare an explicit `type X = { kind: "a"; … } | { kind: "b"; … }` and annotate the array. Confirmed: 2026-09-10.
- **`process.exit` in a `catch`**: the `let x: T; try { x = f(); } catch { …; process.exit(1); }` idiom typechecks because `exit` returns `never`; reuse it instead of non-null assertions. Confirmed: 2026-09-09.

- **CI steps call npm scripts, never raw commands**: add the script to `package.json` first, then `run: npm run <script>`
  in the workflow. Why: it is the pattern for every existing step, and it is what lets a maintainer run locally the
  identical command CI runs instead of a remembered flag. Confirmed: 2026-09-09.
- **Config-only changes are testable too**: when a change lands in JSON/YAML rather than `src/` and the repo rule still
  demands a test, assert the configuration from a unit test (`tests/unit/ciAuditGate.test.ts` reads `package.json`).
  Assert exact values, not substrings, and assert the *absence* of the wrong wiring too. Why: `tsconfig.json` includes
  only `src`, so `npm run typecheck` will not cover the new test file — check it with an explicit
  `npx tsc --noEmit --strict … <file>`, and `npx eslint`/`npx prettier --check` it individually. Confirmed: 2026-09-09.
- **Prove a guard test guards, by mutation**: apply each regression it claims to catch (delete the step, flip
  `continue-on-error`, add `--audit-level`), confirm the suite goes red on each, then restore. Why: a config-reading test
  that silently matches nothing passes just as green as one that works. Confirmed: 2026-09-09.

## Process Friction

- **`npm outdated`'s "Latest" column is not always the highest version**: `@types/node` publishes 26.x but DefinitelyTyped tags `22.20.2` as `latest`. Check `npm view <pkg> dist-tags` before treating a row as "behind". Why: cost a wrong-direction upgrade attempt. Confirmed: 2026-09-09.
- **`npm audit fix` can resolve *downward***: it moved `esbuild` 0.27.3 → 0.27.2 because `tsup@8.5.1` caps it at `^0.27.0` and 0.27.3–0.28.0 are the vulnerable window. A downgrade in the lockfile diff is expected here, not a mistake. Why: looks alarming in review without the explanation. Confirmed: 2026-09-09.
- **`ink@7` broke 11 wizard tests, and the fix is in the test helper**: ink 7 holds a bare ESC for `pendingInputFlushDelayMilliseconds` (20 ms) to disambiguate it from a longer escape sequence, so a `tick()` that only drains `setImmediate` never sees the keypress. `tests/unit/ConfigWizard.test.tsx`'s `tick()` now waits `ESC_FLUSH_MS = 30`. Why: the obvious reading is "ink 7 broke Esc handling in src/" — it did not; `parseKeypress` still maps ESC to `{name:'escape'}`. Confirmed: 2026-09-09.
- **Isolate a multi-upgrade regression by reinstalling one package back**: with everything else at latest, `npm i ink@6` restored 44/44, pinning the cause to ink in one step. Why: far cheaper than bisecting a 370-line lockfile diff. Confirmed: 2026-09-09.
- **Markdown is not Prettier-formatted in this repo**: all pre-existing `docs/*.md` and `README.md` fail `prettier --check`. Do not format a new doc page to match Prettier — match the neighbouring pages. Why: extends the existing `npm run format` friction note to docs. Confirmed: 2026-09-09.
- **The agent's token cannot push anything under `.github/workflows/`**: scopes are `gist, read:org, repo`, and GitHub
  rejects such a push with `refusing to allow an OAuth App to create or update workflow … without workflow scope`. Do
  not design a deliverable around a workflow edit; find an enforcement point in `package.json` and leave the workflow
  change as a documented open item (`gh auth refresh -h github.com -s workflow` is the maintainer's one-liner).
  Do **not** route around it via the Git Data API — that scope exists to stop an app editing CI. Confirmed: 2026-09-09.
- **`npm run lint` is rewritten by the RTK hook** into a whole-repo ESLint run and reports 10 pre-existing errors
  outside `eslint src/`. Use `rtk proxy npm run lint` or `npx eslint src/` to read the real gate. Why: cost a false
  "lint is broken" conclusion. Confirmed: 2026-09-09.
- **A "the plan says X about CI" claim needs `.github/workflows/` read, not assumed**: the 031 plan and docs both stated
  "`npm audit` runs in CI, so a future advisory surfaces there" when no audit step existed. Read the workflow before
  writing any sentence about what CI enforces. Why: a watch item resting on a non-existent gate is worse than no watch
  item. Confirmed: 2026-09-09.
- **A deferred item recorded as "your call" is unfinished work**: when a run ends with an open question addressed to the
  maintainer, expect the next instruction to be "finish it". Decide it autonomously, record the choice and its rationale
  as a converge-pass decision in `research.md`, and add the tasks to `tasks.md` as a new phase rather than editing the
  completed ones. Why: keeps the original run's record intact and reviewable. Confirmed: 2026-09-09.
- **Dependabot alert counts do not match `npm audit` counts**: Dependabot reports one alert per advisory, `npm audit`
  collapses per package — 17 alerts vs 9 audit rows on the same tree in the 031 run. Map each alert's vulnerable range
  against the installed version before claiming the sets agree, and remember the alerts stay open until the branch
  merges, because they are raised against the default branch. Confirmed: 2026-09-09.
- **Verify a lockfile change with `rm -rf node_modules && npm ci`** before claiming the audit is clean. Why: incremental `npm install` steps can leave a tree that a fresh `npm ci` would not reproduce. Confirmed: 2026-09-09.

- **`--json` assertions use `toEqual`, so any added field breaks them**: `doWork.cmd.test.ts`'s "--json reports per-item outcomes" compares the whole item object. Expect exactly one such failure when extending a JSON payload, and record it as a (nominally) breaking change in the PR report rather than loosening the assertion to `toMatchObject`. Confirmed: 2026-09-10.
- **`vitest` does not typecheck, and `tsconfig.json` covers only `src`**: a fixture can be structurally wrong and still pass — a `ReviewThread` literal with a non-existent `id` and a missing `url` ran green. Typecheck a new test file explicitly with `npx tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext --skipLibCheck --types node,vitest/globals <file>`. `doWork.cmd.test.ts` already has one such pre-existing error at line 678. Confirmed: 2026-09-10.
- **Read the interface before writing the fixture** (`grep -n "interface ReviewThread" -A 12`): guessing a shape from its usage cost a round trip here, and the mistake is invisible to the test run. Confirmed: 2026-09-10.
- **`npm run format` is not a gate**: `develop` already fails `prettier --check src/` on 12 files, so `npm test && npm run lint` is the real bar (per `AGENTS.md`). Check new files individually with `npx prettier --check <file>` and reshape code that Prettier would mangle, rather than running `--write` across the tree. Why: a repo-wide reformat would bury the feature diff. Confirmed: 2026-09-09.
- **`create-new-feature.sh` does not create the git branch** despite what `speckit-specify` says. After running it, `git checkout -b feature/<NNN>-<short-name>` manually — the constitution requires the `feature/` prefix, which the script's `BRANCH_NAME` output omits. Confirmed: 2026-09-09.
- **Verify `gh --json` field shapes against a real issue/PR before writing the parser** (`gh issue view <n> --json …`). Why: comment authors nest under `author.login` and comment `id`s are opaque unordered node ids, neither of which is guessable. Confirmed: 2026-09-09.
- **Pre-existing uncommitted work**: `develop` often carries unrelated modified/untracked skill files. Stage only the feature's own paths (`git add src tests docs README.md specs`) instead of `git add -A`. Why: keeps the PR reviewable and does not commit someone else's in-progress work. Confirmed: 2026-09-09.
- **`.automata/config.json` is tracked in this repo**: do not add feature-specific values to it during a run; document what the owner must set in the PR report instead. Confirmed: 2026-09-09.
- **Safe end-to-end smoke test**: build, then run the CLI from a `mktemp -d` cwd with a hand-written `.automata/config.json` and `GH_REPO=<owner>/<repo>` set. Choose inputs that exercise the read-only branch so nothing is posted. Why: proves the real `gh` call and parsing work without side effects on the issue tracker. Confirmed: 2026-09-09.

## Helper Skills

<!--
- **skill-name**: What the helper skill covers and when to use it. Why: short rationale. Confirmed: YYYY-MM-DD.
-->
