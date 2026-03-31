# Agent Notes

This file contains notes for AI coding agents (Codex, Claude, etc.)

## Project: automata-cli

A command-line interface tool built with TypeScript and commander.js.

## Key Technologies

- TypeScript 5.x (strict mode)
- Node.js LTS (18+)
- commander.js for CLI framework
- vitest for testing
- tsup for bundling

## Working Defaults

- Run `npm test && npm run lint` before wrapping up when the change warrants it.
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

## Recent Changes
- 001-config-wizard: Added TypeScript 5.x (strict mode), Node.js LTS + commander.js (existing), ink (new), react (peer dep for ink), @inkjs/ui (optional list selector)
