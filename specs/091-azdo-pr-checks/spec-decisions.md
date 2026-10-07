# Planning Decisions
- Current branch via `pr status`, other branches via `pr list` + `pipeline get-runs --pr`: only `pr status` returns checks and it has no branch option; alternatives were checking out the branch or showing no checks.
- Map states in `azdoService`, Sonar enrichment in `gitService`: `describeSonarCheck` is private there; alternative was exporting it (circular import).
- Reuse the GitHub status/conclusion vocabulary: rendering and `--json` need no change; alternative was a new check shape.
