# Agent Notes

This file contains notes for AI coding agents (Codex, Claude, etc.)

## Project: automata-cli

A command-line interface tool built with TypeScript and commander.js.

## Key Technologies

- TypeScript 5.x (strict mode)
- Node.js 22.12+ to *run* the CLI (floor set by `commander` 15 and `ink` 7; declared in `package.json` `engines`,
  which npm reports as an `EBADENGINE` warning rather than refusing the install)
- Node.js `^22.13.0 || ^24.0.0 || >=26.0.0` to *develop* — the stricter intersection of `eslint@10` and `vitest@5`;
  Node 24 LTS is what CI runs
- commander.js for CLI framework
- vitest for testing
- tsup for bundling

## Working Defaults

- Run `npm test && npm run lint` before wrapping up when the change warrants it.
- After any dependency change, run `npm run audit:prod`. It also runs via `prepublishOnly`, so a production advisory aborts `npm publish`. See `docs/maintenance.md`.
- Prefer minimal, targeted edits that preserve the existing CLI structure.

## Documentation Convention

- `README.md` must stay small: installation, quick-start, a command-group table, and dev setup only.
- Each command group has a dedicated page under `docs/<group>.md` (e.g. `docs/git.md`, `docs/config.md`).
- Every new subcommand must be documented in its group page, not in the README.
- The README command table must link to the relevant `docs/<group>.md` page.
- The `docs/<group>.md` page is the authoritative reference for that command group: options, output format, symbols/legends, exit codes, and examples.

## Active Technologies
- TypeScript 5.x (strict mode), Node.js LTS + commander.js (existing), ink (new), react (peer dep for ink), @inkjs/ui (optional list selector) (001-config-wizard)
- Local file system — `.automata/config.json` (001-config-wizard)
- TypeScript 5.x (strict mode), Node.js LTS + commander.js (CLI framework), `node:child_process` (exec git/gh), `execa` (optional, already not present — use `execSync`/`spawnSync` from Node.js built-ins) (002-git-commands)
- N/A (no persistent data; reads git state and calls `gh` CLI) (002-git-commands)
- TypeScript 5.x (strict mode), Node.js LTS + commander.js (existing), ink + react (existing for wizard), spawnSync from node:child_process (existing pattern) (003-gh-get-ready)
- `.automata/config.json` (existing file, extended with new fields) (003-gh-get-ready)
- TypeScript 5.x (strict mode), Node.js LTS + commander.js (CLI), `gh` CLI via `spawnSync` (GitHub data), `node:child_process` (no execa) (006-get-pr-comments)
- N/A — read-only query (006-get-pr-comments)
- TypeScript 5.x (strict mode) + commander.js (existing), node:child_process (existing) (008-test-command)
- TypeScript 5.x (strict mode) + commander.js (existing), node:child_process (existing pattern) (009-codex-flag-implement-next)
- N/A (no persistent data changes) (009-codex-flag-implement-next)
- TypeScript 5.x (strict mode) + commander.js, ink + react (wizard), vitest (tests) (011-config-prompt-files)
- `.automata/config.json` (existing), `.automata/*.md` (new prompt files) (011-config-prompt-files)
- TypeScript 5.x (strict mode) + commander.js, node:child_process (022-unify-ai-options)
- TypeScript 5.x (strict mode) + commander.js, `gh` CLI via `spawnSync` (033-orphan-pull-requests)

## Recent Changes
- 033-orphan-pull-requests: `do-work` gained a second pass over open pull requests that close no issue of
  this repository, a `pr-orphan` turn kind, `doWork.prompts.prOrphan` and `--pr <number>`
- 001-config-wizard: Added TypeScript 5.x (strict mode), Node.js LTS + commander.js (existing), ink (new), react (peer dep for ink), @inkjs/ui (optional list selector)
