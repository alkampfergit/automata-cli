# Feature Specification: implement-next in Azure DevOps mode

**Branch**: `feature/095-azdo-implement-next` | **Issue**: #95 (part of #89) | **Depends on**: #90, #93 | **Needs**: azdo-cli >= 0.22.0 (F1 `list-items`, F2 `get-item --json`, F4 `comments edit`)

## User Story 1 — Find and claim a work item (P1)
When `remoteType` is `azdo`, `automata implement-next` lists the open work items that match the configured discovery
technique, lets the user choose one (or `--take-first`), shows its markdown description, assigns it, posts a
`working` comment, and runs the AI executor with a prompt that names the work item.

## User Story 2 — Wire the pull request (P1)
After the executor finishes, if the current branch has a pull request, the `working` comment is edited to
"Working on this in PR #… — url", the PR is linked to the work item (`AB#<id>` and an artifact link), and a reviewer
is added when `--ask-copilot-review` is given and `agentUser` is set.

## User Story 3 — The agent opens the PR the Azure DevOps way (P2)
The prompt tells the agent to open the PR with `azdo pr open` and to reference `AB#<id>`, not `gh pr create` / `Closes #N`.

## User Story 4 — The wizard speaks Azure DevOps (P3)
With Azure DevOps chosen, the discovery technique screen reads "By Tag", "By Assigned To", "By Title Contains".

## Requirements
- FR-001 `remoteType: "azdo"` no longer exits early. An absent `remoteType` still exits 1 (as before).
- FR-002 Discovery: `label` → `azdo list-items --tag`, `assignee` → `--assigned-to`, `title-contains` → `--title-contains`,
  with `--json` and `--no-update-check`. Closed work items are dropped; the list is cut to `--limit`.
- FR-003 The list UI, overflow hint, `--query-only`, `--take-first` and `--json` output are unchanged
  (`number`, `title`, `body`, `url`).
- FR-004 Claim: `azdo assign <id> <agentUser or @me>`, then a markdown comment `working`; both failures stop the run
  with exit 1 (as the GitHub comment failure does).
- FR-005 After the run, the claim comment is edited with `azdo comments edit <id> <commentId> --file - --markdown`.
- FR-006 PR wiring goes through `RemoteWriteService` (`getCurrentBranchPr`, `linkPrToIssue`, `requestReview`); the
  GitHub path keeps calling it with the same effect.
- FR-007 The prompt gets an Azure DevOps block (`azdo pr open --work-item <id>`, `AB#<id>`, no `gh`).
- FR-008 Wizard labels and title change with the chosen remote; stored keys do not change.
- FR-009 Docs: `docs/implement-next.md`, `docs/config.md`, `docs/azdo-gap.md`; `CHANGELOG.md` bullet.
- FR-010 Unit tests with fixtures for discovery, claim, PR wiring, wizard labels; GitHub tests stay green.

## Assumptions
- [AUTO] "Open" work item: azdo-cli has no "not closed" filter, so Closed, Done, Removed and Completed are dropped on
  the client. `--top` asks for four times the limit (at least 50) so the cut still fills the list.
- [AUTO] Claimant: `agentUser`, else `@me`, the same rule as the GitHub PR claim.
- [AUTO] Reviewer: `agentUser` is the Azure DevOps reviewer for `--ask-copilot-review`; with no `agentUser` a warning is
  printed, because Azure DevOps has no Copilot. The flag name stays.
- [AUTO] Claim comment reference: `comments add --json` returns `commentId`; the adapter hands that id back as the
  reference and `editIssueComment` uses it. For GitHub the reference stays the comment URL.
- [AUTO] The PR assignee step is skipped in Azure DevOps mode (documented no-op of `assignPr`).
- [AUTO] Only `implement-next`'s prompt gets the Azure DevOps block; `do-work` prompts belong to #99.
- [AUTO] No live tenant: tests stub `spawnSync` with shapes read from azdo-cli 0.23.0.
