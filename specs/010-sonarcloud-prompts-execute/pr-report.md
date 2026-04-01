# PR Report: SonarCloud Integration, Expanded Config, and Execute-Prompt Command

**Branch**: `010-sonarcloud-prompts-execute`  
**Date**: 2026-04-01  
**Spec**: [specs/010-sonarcloud-prompts-execute/spec.md](spec.md)

## Summary

This feature enhances `get-pr-info` to detect SonarCloud checks on a PR and fetch the new-issue count from the public SonarCloud API, giving developers immediate visibility into code quality issues without leaving the terminal. It also restructures the config wizard into a menu-driven UI, adds a `prompts.sonar` configuration field, and introduces an `execute-prompt sonar` command that invokes Claude or Codex with the Sonar prompt and analysis URL.

## What's New

<!-- To be completed after implementation -->

- **[Area / Component]**: [What was added or changed and why]

## Testing

<!-- To be completed after implementation -->

- **[Unit]**: [Coverage details]

## Notes

- SonarCloud integration only works for public projects (no auth token required).
- `--verbose` on `execute-prompt sonar` is passed to Claude only; ignored for Codex (consistent with existing pattern).
