# Research

## Autonomous Decisions

- **Decision**: Resolve an id with `gh api repos/{o}/{r}/issues/<n>`. **Rationale**: one call tells issue from PR (`pull_request` key) and gives state/title. **Alternatives considered**: `gh issue view` then `gh pr view` fallback (two calls, ambiguous errors).
- **Decision**: Find linked PRs with `getOpenPrLinkMap().byIssue`. **Rationale**: existing, authoritative closing-reference map. **Alternatives considered**: a new timeline query.
- **Decision**: Apply discovery with `gh issue edit` / `gh pr edit`. **Rationale**: matches `assignIssueToAgent`/`assignPrToAgent`. **Alternatives considered**: REST label endpoints.
