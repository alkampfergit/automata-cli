# Research

## Autonomous Decisions

- **Decision**: Follow `workPrompt.ts`: frame first, then assembled context. **Rationale**: a repository can rewrite the instructions without losing data. **Alternatives considered**: a template with placeholders.
- **Decision**: Reuse `analyzeSurface` and `formatMessages` for filtering and rendering. **Rationale**: one rule for who may be read. **Alternatives considered**: a new filter.
- **Decision**: Fetch checks with a separate `getPrChecks`. **Rationale**: `getPrSurface` stays unchanged for `do-work`. **Alternatives considered**: add checks to `PrSurface`.
