# PR Report: Get PR Open Comments

**Branch**: `006-get-pr-comments`
**Date**: 2026-03-31
**Spec**: [specs/006-get-pr-comments/spec.md](spec.md)

## Summary

Adds `automata git get-pr-comments`, a new subcommand that fetches and displays unresolved review thread comments for the current branch's GitHub pull request. Developers can now triage reviewer feedback directly from the terminal without switching to the GitHub web UI. The command supports both human-readable and `--json` output; Azure DevOps is not supported and the limitation is documented in `docs/azdo-gap.md` as Gap #3.

## What's New

- **`automata git get-pr-comments` command**: New subcommand in `src/commands/git.ts`. Lists unresolved review threads for the current branch's PR in human-readable format (author, file:line, body) or as a `--json` array. Exits 0 on success (including "no open comments"), 1 on any error.
- **`PrComment` type + `getPrComments()` service function**: New exported interface and function in `src/git/gitService.ts`. Uses `gh pr view --json reviewThreads` and filters threads where `isResolved === false`. Returns `"unsupported"` sentinel for AzDO remote type; `null` when no PR exists.
- **`docs/azdo-gap.md` Gap #3**: Documents that `get-pr-comments` is unavailable in Azure DevOps mode because `azdo pr status --json` provides no review thread data. Explains what Azure DevOps REST API endpoint would close the gap.
- **`docs/git.md`**: Full command reference for `get-pr-comments` including options, human-readable and JSON output examples, and exit codes.

## Testing

- **Unit**: 5 new tests in `tests/unit/git.cmd.test.ts` covering: unresolved threads returned correctly, resolved threads filtered out, empty array when all resolved, `null` when no PR found, `line: null` for file-level comments. CLI smoke test updated to assert `get-pr-comments` appears in `automata git --help`.
