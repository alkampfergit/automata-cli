# Research: Azure DevOps Remote Support

**Feature Branch**: `005-azdo-remote-support`
**Date**: 2026-03-31
**Spec**: [spec.md](spec.md)

## azdo-cli Capability Audit (v0.5.0)

### `azdo pr status --json` — JSON output shape

```json
{
  "branch": "branch-name",
  "repository": "repo-name",
  "pullRequests": [
    {
      "id": 123,
      "title": "My PR",
      "repository": "repo-name",
      "sourceRefName": "refs/heads/branch-name",
      "targetRefName": "refs/heads/develop",
      "status": "active" | "completed" | "abandoned",
      "createdBy": "User Name" | null,
      "url": "https://dev.azure.com/..."
    }
  ]
}
```

Source: inspected `/home/node/.npm/_npx/.../azdo-cli/dist/index.js` → `createPrStatusCommand()` + `mapPullRequest()`.

**Status mapping to PrInfo.state:**
| AzDO `status` | PrInfo `state` |
|---------------|----------------|
| `active`      | `OPEN`         |
| `completed`   | `MERGED`       |
| `abandoned`   | `CLOSED`       |

**Checks/Policies**: `azdo pr status` does NOT return policy evaluations. `PrInfo.checks` will always be `[]` in azdo mode. This is a documented gap.

### `azdo comments add <id> <text>` — Work item comment

Accepts a numeric work item ID and text. Equivalent to `gh issue comment <id> --body <text>`. AVAILABLE — can be used to claim work items.

### Work item listing — NOT AVAILABLE

No `azdo list-items`, `azdo search`, or equivalent command exists in azdo-cli v0.5.0. The only work item commands require a known ID: `get-item`, `set-state`, `assign`, `set-field`, `get-md-field`, `set-md-field`, `list-fields`, `comments list/add`.

This is the primary capability gap affecting `automata get-ready`.

---

## Feature Parity Matrix

| automata-cli Feature | GitHub (`gh`) Command | AzDO (`azdo`) Command | Status |
|---------------------|-----------------------|-----------------------|--------|
| Get PR info | `gh pr view <branch> --json number,title,state,url,statusCheckRollup` | `azdo pr status --json` | **Partial** — no checks |
| PR check/policy status | included in above | ❌ Not available | **Gap** |
| List issues/work items | `gh issue list --json` | ❌ Not available | **Gap** |
| Post issue comment | `gh issue comment <id> --body <text>` | `azdo comments add <id> <text>` | **Available** |
| Finish feature (merged check) | PR state from `gh pr view` | PR status `completed` from `azdo pr status` | **Available** |
| Finish feature (git ops) | git-native | git-native | **Available** |

---

## Architecture Analysis

### Current call graph

```
commands/git.ts
  ├── gitService.getPrInfo(branch)       → gh pr view ...
  ├── gitService.isUpstreamGone(branch)  → git ls-remote
  ├── gitService.hasUncommittedChanges() → git status
  ├── gitService.fetchPrune()            → git fetch --prune
  ├── gitService.checkoutAndPull(branch) → git checkout + git pull
  └── gitService.deleteLocalBranch()    → git branch -D

commands/getReady.ts
  ├── githubService.listIssues(...)      → gh issue list
  └── githubService.postComment(...)    → gh issue comment

config/configStore.ts — reads remoteType
```

### Decision: Where to add dispatch

**Decision**: Add `src/config/azdoService.ts` containing azdo-specific PR and comment functions. Modify `src/git/gitService.ts` to read `remoteType` from config and dispatch `getPrInfo` to either the existing gh call or the new azdo function. Commands remain unchanged.

**Rationale**: Minimal surface change. `getPrInfo` in `gitService.ts` is the single integration point for PR data; adding dispatch there avoids touching command files. All git-native operations (fetchPrune, checkoutAndPull, deleteLocalBranch, isUpstreamGone) are already provider-agnostic and need no changes.

**Alternatives considered**:
- Create `remoteService.ts` dispatcher imported by commands: more layers, requires changing command imports.
- Put azdo logic directly in `gitService.ts`: mixes concerns, harder to test in isolation.

---

## Autonomous Decisions

- **[AUTO] PR status dispatch in gitService**: Chosen because it is the minimal change point with zero impact on command files.
- **[AUTO] Empty checks array for azdo**: The gap is documented; empty array matches the existing `PrInfo` type contract without a new nullable field.
- **[AUTO] get-ready azdo error**: Updated error message references `docs/azdo-gap.md` explicitly instead of the current generic "gh mode only" message.
- **[AUTO] azdo-cli as devDependency**: azdo-cli is invoked via `spawnSync` (same pattern as gh); it does NOT need to be listed in package.json dependencies since it is an external tool the user installs separately, identical to how `gh` is handled.
