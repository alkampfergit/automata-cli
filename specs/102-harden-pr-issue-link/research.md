# Research: 102

## Autonomous Decisions
- **Decision**: look up by `gh pr list --head <branch> --state open`. **Rationale**: independent of checkout; lists multiple bases. **Alternatives considered**: `gh pr view <branch>` (returns one PR, error-prone on ambiguity); keep `getCurrentBranchPr`.
- **Decision**: candidates = end branch + branches absent from a pre-run snapshot, minus base. **Rationale**: safe against release PRs, no network. **Alternatives considered**: search PRs by author/assignee (could touch unrelated PRs); branch-name pattern (fragile).
- **Decision**: one shared `hasClosingRef` used by the check and by `addClosesRefToPr`. **Rationale**: the two disagreed (`includes` vs regex). **Alternatives considered**: leave `includes`.
