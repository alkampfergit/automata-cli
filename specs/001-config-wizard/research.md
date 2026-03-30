# Research: Config Wizard

**Branch**: `001-config-wizard` | **Date**: 2026-03-30

## ink Framework Integration

**Decision**: Add `ink` and `react` as runtime dependencies; use `ink`'s built-in `useInput` + `Box`/`Text` components for a simple arrow-key list selector.
**Rationale**: ink is the standard React-for-CLIs library for Node.js. It integrates with commander.js by calling `render()` from within a command action. React is required as a peer dependency.
**Alternatives considered**: `blessed` / `terminal-kit` — heavier, not React-based, harder to compose. `enquirer` / `prompts` — simpler but not ink; the spec explicitly requires ink.

## Commander.js + ink Co-existence

**Decision**: The `config` command (without subcommands) launches the ink wizard via `render(<ConfigWizard />)`. The `config set type <value>` subcommand runs synchronously without ink.
**Rationale**: Commander.js action callbacks are async-compatible. Calling `render()` from an async action works because `render()` returns a promise that resolves when the component unmounts.
**Alternatives considered**: Separate entry point for wizard — rejected, adds complexity without benefit.

## Config File Format

**Decision**: `{ "remoteType": "gh" | "azdo" }` stored as pretty-printed JSON at `.automata/config.json`.
**Rationale**: Single key, human-readable, easy to extend.
**Alternatives considered**: TOML/YAML — overkill for one key; adds parse dependencies.

## TSX / JSX Support in tsup

**Decision**: Rename ink component files to `.tsx` and add `jsx: "react-jsx"` to tsconfig. tsup supports TSX out of the box.
**Rationale**: ink components use JSX. tsup auto-detects `.tsx` files.
**Alternatives considered**: `React.createElement` without JSX — valid but verbose and harder to maintain.

## Autonomous Decisions

- **Decision**: Add `"jsx": "react-jsx"` to tsconfig compilerOptions.
  **Rationale**: Required for JSX transform without importing React in every file. tsup handles the rest.
  **Alternatives considered**: Classic `"react"` transform — requires explicit `import React` in every file; rejected for modern style.
