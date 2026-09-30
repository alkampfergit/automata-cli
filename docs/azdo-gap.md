# Azure DevOps Gap Analysis

What automata-cli can and cannot do in Azure DevOps (`azdo`) mode, measured against **azdo-cli 0.20.0**
(the minimum supported version). Every "not supported in Azure DevOps mode" message links here.

Status legend: ✅ supported by azdo-cli · ⚠️ partial · ❌ missing in azdo-cli.

## What works in automata today

| Command | Backend call |
|---|---|
| `automata git get-pr-info` | `azdo pr status --json` (checks are not yet mapped) |
| `automata git finish-feature` | `azdo pr status --json`, `status: "completed"` confirms the merge |

Everything else short-circuits when `remoteType` is `azdo`. The epic tracked in issue #89 closes the gaps below.

## gh → azdo mapping

| automata need | gh today | azdo-cli 0.20.0 | |
|---|---|---|---|
| PR for branch, all states | `gh pr list --head --state all` | `azdo pr list --branch --status all --json` | ✅ |
| PR for current branch | `gh pr view --json` | `azdo pr status --json` | ✅ |
| PR checks | `statusCheckRollup` + check-runs API | `pr status --json` → `checks[]` (policy + status, `targetUrl`) | ✅ |
| Unresolved review threads | GraphQL `reviewThreads` | `azdo pr comments --json --exclude-resolved` | ✅ |
| Edit PR body | `gh pr edit --body` | `azdo pr update --description-file -` | ✅ |
| Link PR ↔ issue | `Closes #N` in body | `azdo pr work-items link <id>` (write only) | ✅ |
| Add reviewer | `gh pr edit --add-reviewer` | `azdo pr reviewers add` | ✅ |
| Comment on issue | `gh issue comment` | `azdo comments add <id>` | ✅ |
| Assign issue | `gh issue edit --add-assignee` | `azdo assign <id>` | ✅ |
| Authenticated login | `gh api user` | `azdo auth diagnose --json` | ✅ |
| List / filter issues | `gh issue list --label/--assignee/--search` | none | ❌ |
| Read issue as JSON | `gh issue view --json` | `get-item` has no `--json` | ❌ |
| Comment author identity | `author.login` | display name only | ⚠️ |
| Edit / delete comment | REST PATCH/DELETE | work item: none; PR: edit ✅, delete ❌ | ❌ |
| Draft PR, explicit base | `gh pr create --draft --base` | `pr open` always targets `develop` | ❌ |
| PRs → closing issues, bulk | GraphQL `closingIssuesReferences` | none | ❌ |

Commands blocked by a ❌ row (`implement-next`, `do-work`, `execute-prompt check-issue`) stay unavailable in
Azure DevOps mode until their child issue lands. `execute-prompt fix-comments` and `git get-pr-comments` are a
different case: the capability exists (`azdo pr comments --json --exclude-resolved`, ✅ above) but is not wired
into automata yet.

## Foundation (issue #90)

- **Backend selector**: `src/remote/backend.ts` — `selectBackend(config)` returns `gh` unless `remoteType` is `azdo`.
- **Origin parsing**: `src/remote/originUrl.ts` recognises `https://dev.azure.com/{org}/{project}/_git/{repo}`,
  `https://{org}.visualstudio.com/[DefaultCollection/]{project}/_git/{repo}` and
  `git@ssh.dev.azure.com:v3/{org}/{project}/{repo}`, plus GitHub https/ssh.
- **Prerequisite check**: `src/remote/azdoPrerequisites.ts` verifies `azdo` is on PATH, `azdo --version` ≥ 0.20.0,
  and `azdo auth diagnose --json` reports an `identity`. Every call passes `--no-update-check` so the update banner
  never pollutes parsed output. `git get-pr-info` and `git finish-feature` run it before the first `azdo` call and stop
  with its message on failure; a success is remembered for the process. They also fail early when `remoteType` is `azdo`
  but `origin` is a GitHub URL. An `origin` that matches no known form is tolerated.
