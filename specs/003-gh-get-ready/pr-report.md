# PR Report: GitHub Issue Discovery and Auto-Implementation (get-ready)

**Branch**: `003-gh-get-ready`
**Date**: 2026-03-30
**Spec**: [specs/003-gh-get-ready/spec.md](./spec.md)

## Summary

This feature adds a `get-ready` command that discovers the next open GitHub issue matching a configured filter (by label, assignee, or title substring), posts a "working" comment to claim it, and invokes Claude Code locally to implement it. It also extends the configuration system with three new settings — issue discovery technique, filter value, and Claude system prompt — available when GitHub mode is active.

## What's New

- **`automata get-ready` command**: New top-level command that queries open GitHub issues using the configured filter, prints the matched issue, posts a "working" comment, and invokes Claude Code with the issue body as the prompt. Supports `--json` for machine-readable output and `--no-claude` to skip Claude Code invocation.
- **Config extensions — three new `config set` subcommands**: `automata config set issue-discovery-technique` (label / assignee / title-contains), `automata config set issue-discovery-value`, and `automata config set claude-system-prompt` allow scriptable configuration of the new fields.
- **ConfigWizard extended with GitHub-specific screen**: When GitHub mode is selected in the interactive config wizard, a follow-up screen collects the issue discovery technique, filter value, and optional Claude system prompt.
- **`src/config/githubService.ts`**: New module wrapping `gh issue list` and `gh issue comment` CLI calls, following the same `spawnSync` pattern as `gitService.ts`.

## Testing

- **Unit tests — configStore**: Round-trip tests for the three new config fields (`issueDiscoveryTechnique`, `issueDiscoveryValue`, `claudeSystemPrompt`) added to `tests/unit/configStore.test.ts`.
- **Unit tests — githubService**: Full coverage of `listIssues` (all three filter techniques, empty result, gh error, ENOENT) and `postComment` (success, error, ENOENT) in `tests/unit/githubService.test.ts`.
- **Unit tests — getReady command**: Validation logic (azdo error, missing technique error), Claude Code argument construction (with/without system prompt), and `--no-claude` flag in `tests/unit/getReady.cmd.test.ts`.
- **CLI smoke tests — config set subcommands**: Integration tests verifying the three new `config set` subcommands write correct values to `.automata/config.json`, added to `tests/unit/config.cmd.test.ts`.
- **CLI smoke tests — get-ready help**: Verifies `get-ready` appears in top-level help and its own `--help` output lists `--json` and `--no-claude`.

## Notes

- Claude Code invocation uses `claude -p "<combined prompt>"` where the combined prompt is `"<systemPrompt>\n\n<issueBody>"` when a system prompt is configured, or just `<issueBody>` otherwise. This avoids reliance on version-specific `--system-prompt` flags.
- The "working" comment is always posted before Claude Code is invoked, so the issue is claimed even if Claude Code fails or is unavailable.
- The `ConfigWizard` second screen (GitHub-specific settings) is text-based character-by-character input for the discovery value and system prompt fields. For long prompts, `automata config set claude-system-prompt` is more ergonomic.
