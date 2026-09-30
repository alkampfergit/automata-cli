# Research
## Decision: current branch via `pr status`, other branches via `pr list` + `pipeline get-runs --pr`
**Rationale**: only `pr status` returns `checks[]`, and it has no branch option; `get-runs --pr` is the one per-PR source of check-like data.
**Alternatives considered**: checkout the branch (mutates the tree); return no checks for other branches (contradicts the issue).
## Decision: map states in `azdoService`, enrich with Sonar in `gitService`
**Rationale**: `describeSonarCheck` is private to `gitService`; the azdo module stays free of Sonar/HTTP.
**Alternatives considered**: export Sonar helpers into azdoService (circular import).
## Decision: reuse the GitHub status/conclusion vocabulary
**Rationale**: `checkSymbol`, summary and `--json` then need no change.
**Alternatives considered**: a new check shape (would fork rendering).
