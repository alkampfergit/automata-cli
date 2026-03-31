# PR Report: Config Wizard

**Branch**: `001-config-wizard`
**Date**: 2026-03-30
**Spec**: [specs/001-config-wizard/spec.md](./spec.md)

## Summary

Introduces the `automata config` command with two modes: an interactive terminal wizard powered by the `ink` framework that lets users select the remote environment type (GitHub or Azure DevOps) using arrow keys, and a non-interactive `automata config set type <gh|azdo>` subcommand for scripted or CI environments. Configuration is saved as JSON to `.automata/config.json` in the working directory.

## What's New

- **`automata config` (interactive wizard)**: New command that renders a keyboard-navigable ink UI to select the remote environment type. Pre-selects the current value when config already exists. Writes `.automata/config.json` on confirm; exits cleanly on Ctrl+C.
- **`automata config set type <gh|azdo>` (non-interactive)**: New subcommand that sets `remoteType` without a UI; validates input and exits with code 1 on invalid values.
- **Config store (`src/config/configStore.ts`)**: Shared module for reading and writing `.automata/config.json`; auto-creates the `.automata` directory; treats missing or corrupted config as an empty config.
- **`ConfigWizard` ink component (`src/config/ConfigWizard.tsx`)**: Self-contained React/ink component; reads current config on mount and writes it on confirm.

## New Libraries / Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| ink     | ^6.8.0  | React-based rich terminal UI framework for the interactive wizard |
| react   | ^19.2.4 | Required peer dependency for ink |

## Testing

- **Unit (configStore)**: Tests for `readConfig` (missing file, corrupted JSON, valid file) and `writeConfig` (directory auto-creation, overwrite) via direct imports with a patched `process.cwd`.
- **Unit (config command)**: Tests for `config set type gh`, `config set type azdo`, and `config set type invalid` via `execSync` against the compiled CLI binary.
- **Manual**: `automata config` wizard renders correctly in a TTY; arrow-key navigation and Enter/Ctrl+C behave as specified.

## Notes

- Only `remoteType` is configurable in this release; additional config keys are deferred.
- The `ink` wizard requires a TTY. Running `automata config` in a non-TTY environment (e.g., piped output) will not render interactively; use `config set type` instead.
