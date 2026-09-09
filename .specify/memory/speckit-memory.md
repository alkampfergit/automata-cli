# Speckit Execution Memory

Use this file for stable, reusable lessons learned from completed `speckit-full` runs.

Keep entries short. Prefer rules over narratives. Update or remove entries when the codebase or workflow changes.

## Autonomous Defaults

- **New AI-invoking command**: add it as an `execute-prompt` subcommand rather than a new top-level command whenever the shape is "gather remote context → compose configured prompt → invoke Claude/Codex". Why: `addAiOptions()` in `src/commands/executePrompt.ts` already supplies the `--with` / `--model` / `--silent` / `--push` contract, so a top-level command would duplicate it. Confirmed: 2026-09-09.
- **Configurable prompts**: every new AI prompt gets a `prompts.<name>` config key, an exported `DEFAULT_<NAME>_PROMPT`, a `resolvePromptRef()` call in `readConfig()`, and a `Prompts → <Name>` wizard screen writing `.automata/<name>-prompt.md`. Why: this is the established four-point pattern; missing any one of them makes the prompt un-editable through the documented path. Confirmed: 2026-09-09.
- **New config keys are reachable two ways**: a `automata config set <kebab-name>` subcommand *and* a wizard screen. Why: every pre-existing key is, and users are pointed at both in error messages. Confirmed: 2026-09-09.
- **"Nothing to do" is exit 0**: commands meant to be polled report no-work on stdout and exit 0 rather than failing. Why: matches `implement-next`'s "No issues found" behaviour and keeps `set -e` wrappers usable. Confirmed: 2026-09-09.
- **Remote gating**: reject only an explicit `remoteType: "azdo"` (pointing at `docs/azdo-gap.md`) and treat an absent `remoteType` as GitHub, unless the command's whole behaviour is remote-specific like `implement-next`'s discovery. Why: demanding a rarely-set key adds friction without safety. Confirmed: 2026-09-09.

## Implementation Patterns

- **Pure logic in its own module**: keep `gh`/`git` I/O wrappers in the existing service files (they hold the private `spawnSync` runner) and put decision/formatting logic in a sibling domain module (e.g. `src/github/issueConversation.ts`). Why: the rules become unit-testable without mocking the `gh` CLI, and duplicating the runner would violate the constitution's no-duplication rule. Confirmed: 2026-09-09.
- **`gh --json` payloads**: declare a private `Raw…` interface for the CLI shape and normalise it (flatten `author.login`, sort by `createdAt`) before returning an exported interface. Why: strict mode forbids `any`, and callers should never handle two shapes. Confirmed: 2026-09-09.
- **ISO timestamps compare as strings**: `gh` returns normalised `YYYY-MM-DDTHH:MM:SSZ`, so use `localeCompare`/`>` instead of parsing dates. Why: less code and no `NaN` failure mode. Confirmed: 2026-09-09.
- **Literal unions in object literals**: annotate `kind: "issue" as const` (or type the array) when building objects assigned to a union-typed field — `tsc` widens to `string` otherwise and `vitest` will not catch it because it does not typecheck. Why: cost a debug cycle. Confirmed: 2026-09-09.
- **Command tests mock the services, not the CLI**: `vi.mock` every module `executePrompt.ts` imports (including `src/git/gitService.js`, which is imported for the other subcommands), then `await executePromptCommand.parseAsync(["node", "execute-prompt", "<sub>", …])` and assert on the composed prompt string. Why: this is the pattern in `executePromptFixComments.cmd.test.ts` and it survives refactors of the option plumbing. Confirmed: 2026-09-09.
- **Order-sensitive side effects**: when a comment/commit must happen before the AI runs, assert it with a shared `order: string[]` pushed from both mock implementations. Why: `toHaveBeenCalled` cannot express "before". Confirmed: 2026-09-09.
- **Wizard menu additions go last**: append to `MAIN_MENU_OPTIONS` / `PROMPTS_MENU_OPTIONS` and replace the trailing `else` in the dispatch with explicit branches. Why: `tests/unit/ConfigWizard.test.tsx` navigates by counting `DOWN` presses, so inserting an entry breaks unrelated tests. Confirmed: 2026-09-09.
- **`process.exit` in a `catch`**: the `let x: T; try { x = f(); } catch { …; process.exit(1); }` idiom typechecks because `exit` returns `never`; reuse it instead of non-null assertions. Confirmed: 2026-09-09.

## Process Friction

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
