# PR Report: SonarCloud Integration, Expanded Config, and Execute-Prompt Command

**Branch**: `010-sonarcloud-prompts-execute`  
**Date**: 2026-04-01  
**Spec**: [specs/010-sonarcloud-prompts-execute/spec.md](spec.md)

## Summary

This feature enhances `get-pr-info` to detect SonarCloud checks on a PR and fetch the new-issue count from the public SonarCloud API, giving developers immediate visibility into code quality issues without leaving the terminal. It also restructures the config wizard into a menu-driven UI, adds a `prompts.sonar` configuration field, and introduces an `execute-prompt sonar` command that invokes Claude or Codex with the Sonar prompt and analysis URL.

## What's New

- **`get-pr-info` — SonarCloud detection**: The command now detects a SonarCloud check on the PR (by matching `sonarcloud.io` in the check's detail URL), fetches the new-issue count from the public SonarCloud API, and includes `sonarcloudUrl` and `sonarNewIssues` in both human-readable and JSON output.
- **Config schema — `prompts.sonar` field**: `AutomataConfig` gains a `prompts?: { sonar?: string }` field. A built-in default Sonar prompt is exported as `DEFAULT_SONAR_PROMPT`.
- **Config wizard — menu-driven UI**: The interactive `automata config` wizard is rewritten with a top-level main menu offering three sections: "Remote / Mode", "Implement-Next", and "Prompts". The "Prompts" section exposes a Sonar prompt editor.
- **`automata execute-prompt sonar` — new command**: Looks up the SonarCloud analysis URL for the current branch's PR and invokes Claude (or Codex with `--codex`) with the configured Sonar prompt and the URL as context. Supports `--verbose` (Claude only) and model selection flags.

## Testing

- **Unit — `configStore.test.ts`**: Verified `prompts.sonar` round-trips through `writeConfig`/`readConfig`; verified `DEFAULT_SONAR_PROMPT` is exported and non-empty.
- **Unit — `git.commands.test.ts`**: Verified SonarCloud URL and new-issue count appear in human-readable and JSON output; verified graceful handling when the SonarCloud API fails; verified no SonarCloud fields when no SonarCloud check is present.
- **Unit — `executePrompt.cmd.test.ts`**: Verified Claude invocation with default and custom Sonar prompts; verified Codex dispatch with `--codex`; verified `--verbose` passed correctly; verified error paths (no PR found, no SonarCloud URL).
- **Unit — `git.cmd.test.ts`**: Updated existing `getPrInfo` unit tests to `await` the now-async function.

## Notes

- SonarCloud integration only works for public projects (no auth token required). Private projects will show the SonarCloud URL but `sonarNewIssues` will be `null`/`unavailable`.
- `--verbose` on `execute-prompt sonar` is passed to Claude only; consistent with existing `--verbose` handling in `implement-next` and `test codex`.
