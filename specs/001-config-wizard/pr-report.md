# PR Report: Config Wizard

**Branch**: `001-config-wizard`
**Date**: 2026-03-30
**Spec**: [specs/001-config-wizard/spec.md](./spec.md)

## Summary

Introduces the `automata config` command with two modes: an interactive terminal wizard (powered by the `ink` framework) that guides users through setting the remote environment type, and a non-interactive `automata config set type <gh|azdo>` subcommand for scripted environments. Configuration is persisted as JSON to `.automata/config.json` in the working directory.

## What's New

<!-- Completed in Phase 7 -->

- **[Area / Component]**: [What was added or changed and why]

## New Libraries / Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| [ink]   | [TBD after install] | Rich interactive terminal UI for the config wizard |
| [react] | [TBD after install] | Peer dependency required by ink |

## Testing

<!-- Completed in Phase 7 -->

- **[Unit / Integration / E2E / Manual]**: [What scenario or component was covered]

## Notes

- Only `remoteType` is configurable in this release; additional config keys are deferred.
