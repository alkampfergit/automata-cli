# Research: Sonar Failure Details in get-pr-info

## Decision 1: Reuse the existing SonarCloud detection entry point

**Decision**: Continue detecting SonarCloud from the existing PR check URL and hang the richer failure lookup off the same `getPrInfo` flow.

**Rationale**: `get-pr-info` already identifies SonarCloud checks and exposes `sonarcloudUrl` and `sonarNewIssues`. Extending that path keeps the feature local to existing GitHub PR inspection logic and avoids introducing a separate command or duplicated lookup path.

**Alternatives considered**:

- Add a separate Sonar-specific command for failure details. Rejected because the user explicitly wants the data inside `get-pr-info`.
- Infer Sonar status from check names only. Rejected because URLs are already present and are more stable than display names.

## Decision 2: Model Sonar failure data as structured PR metadata

**Decision**: Add a structured Sonar failure payload to `PrInfo` that can represent gate violations, issues, and a private-project note.

**Rationale**: The user wants the "return value" to be rich enough for Claude or Codex to fix problems directly. A structured payload is safer for `--json` consumers and can also drive deterministic human-readable rendering.

**Alternatives considered**:

- Embed a single formatted string into `description`. Rejected because it is fragile for machine use and loses field boundaries.
- Expose only human-readable lines. Rejected because AI and script consumers would need to parse terminal text.

## Decision 3: Treat HTTP 401 as an explicit private-project outcome

**Decision**: When SonarCloud returns HTTP 401 for failure-detail requests, surface a private-project note instead of treating the response as a generic unavailable error.

**Rationale**: The user explicitly requested this distinction. It gives a clear next step: open the existing Sonar URL in an authenticated browser.

**Alternatives considered**:

- Keep returning `null` or `unavailable`. Rejected because it hides the actual reason and makes the output less actionable.
- Fail the whole command on 401. Rejected because base PR information is still valid and the requested behavior is informational, not fatal.

## Decision 4: Query both quality gate status and PR issues

**Decision**: Fetch both quality gate conditions and pull-request-scoped issues when Sonar failure details are needed.

**Rationale**: The user explicitly asked for two categories of information: gate violations and issues with possible description, location, and explanation. Both are needed to make the output sufficient for AI-assisted fixes.

**Alternatives considered**:

- Fetch only issues. Rejected because some Sonar failures come from quality gate metrics that are not represented as issues.
- Fetch only quality gate status. Rejected because it would miss code-level findings and file locations.

## Autonomous Decisions

- Used the existing `get-pr-info` command rather than creating a new Sonar command because the requested UX is an augmentation of current PR output.
- Chose structured Sonar failure objects in `PrInfo` because the user explicitly wants the return value to be AI-consumable.
- Reserved the private-project note for HTTP 401 only because that was the requested signal; other failures remain generic "unavailable" conditions.
