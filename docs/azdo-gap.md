# Azure DevOps Gap Analysis

This document lists automata-cli features that are **not fully supported** in Azure DevOps (`azdo`) mode, using `azdo-cli@0.5.0`.

For each gap the document explains what is missing, why it cannot be implemented with the current version of azdo-cli, and what would be needed to close the gap.

---

## Supported in AzDO Mode

The following features work correctly when `remoteType` is set to `azdo`:

| Feature | Command | Notes |
|---------|---------|-------|
| View PR info | `automata git get-pr-info` | Uses `azdo pr status --json`. PR number, title, state, and URL are returned. |
| Finish feature branch | `automata git finish-feature` | Uses `azdo pr status --json` to confirm PR is merged (`status: "completed"`) before deleting the local branch. |

---

## Gaps

### 1. Work Item Discovery — `automata get-ready` is unavailable in AzDO mode

**Affected command**: `automata get-ready`

**What GitHub supports**: `gh issue list` accepts `--label`, `--assignee`, and `--search` flags to filter and return open issues. automata-cli uses this to discover the next piece of available work.

**What azdo-cli provides**: No work item listing or search command. Every azdo-cli work item command (`get-item`, `set-state`, `assign`, `set-field`, `list-fields`, `comments list/add`) requires a known work item ID. There is no way to query "give me open work items matching filter X" through azdo-cli.

**Impact**: `automata get-ready` exits immediately with a non-zero code in AzDO mode. No work item is discovered or claimed.

**What would close this gap**: A future version of azdo-cli that adds a `list-items` or `search` command accepting state, tag/label, and assignee filters would allow full parity. Alternatively, automata-cli could directly call the Azure DevOps REST API (`/_apis/wit/wiql` or `/_apis/wit/workitems`) using a stored PAT, without relying on azdo-cli for this capability.

---

### 2. PR Check / Policy Status — `automata git get-pr-info` shows no checks in AzDO mode

**Affected command**: `automata git get-pr-info`

**What GitHub supports**: `gh pr view --json statusCheckRollup` returns a list of CI check runs with name, status (QUEUED / IN_PROGRESS / COMPLETED), conclusion (SUCCESS / FAILURE / etc.), and a description. automata-cli renders these with ✓ ✗ ● ○ symbols.

**What azdo-cli provides**: `azdo pr status --json` returns `{ id, title, status, url }` per pull request. No policy evaluation results or build pipeline status are included in the response.

**Impact**: The `checks` array returned by `get-pr-info --json` is always empty in AzDO mode. The human-readable output shows `Checks: none` regardless of actual pipeline state.

**What would close this gap**: A future version of azdo-cli that includes policy evaluation results (Azure DevOps REST API: `/_apis/policy/evaluations?artifactId=...`) in the `azdo pr status --json` output would allow check rendering. Alternatively, automata-cli could query the Azure DevOps Pipelines API directly for build run results associated with the PR.

---

## azdo-cli Version Tested

`azdo-cli@0.5.0` — published 2026-03-29.

Check for updates: `npm show azdo-cli dist-tags`
