# PR Report: implement-next in Azure DevOps mode

**Branch**: `feature/095-azdo-implement-next`
**Date**: 2026-10-17
**Spec**: specs/095-azdo-implement-next/spec.md

## Summary

`automata implement-next` now works against an Azure DevOps repository. It finds open work items through
`azdo list-items`, claims one (assign plus a `working` comment), runs the AI executor, and then wires the pull request
to the work item. The GitHub path is unchanged.

## What's New

- **Discovery**: `src/remote/azdoWorkItems.ts` maps label/assignee/title-contains to tag/assigned-to/title.
- **Write adapter**: `editIssueComment` added to `RemoteWriteService`; `implement-next` wires the PR through it.
- **Prompt**: an Azure DevOps block tells the agent to use `azdo pr open` and `AB#<id>`.
- **Wizard**: Azure DevOps wording for the discovery technique.
- **Docs**: `docs/implement-next.md`, `docs/config.md`, `docs/azdo-gap.md`, `CHANGELOG.md`.

## Testing

- **Unit**: discovery mapping and closed-state filter, comment edit, command flow in Azure DevOps mode, wizard labels.
- **Regression**: the existing GitHub `implement-next` tests run unchanged.
