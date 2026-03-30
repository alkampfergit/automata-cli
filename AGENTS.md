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

## Active Technologies
- TypeScript 5.x (strict mode), Node.js LTS + commander.js (existing), ink (new), react (peer dep for ink), @inkjs/ui (optional list selector) (001-config-wizard)
- Local file system — `.automata/config.json` (001-config-wizard)
- TypeScript 5.x (strict mode), Node.js LTS + commander.js (CLI framework), `node:child_process` (exec git/gh), `execa` (optional, already not present — use `execSync`/`spawnSync` from Node.js built-ins) (002-git-commands)
- N/A (no persistent data; reads git state and calls `gh` CLI) (002-git-commands)

## Recent Changes
- 001-config-wizard: Added TypeScript 5.x (strict mode), Node.js LTS + commander.js (existing), ink (new), react (peer dep for ink), @inkjs/ui (optional list selector)
