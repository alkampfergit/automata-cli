# Research

## Autonomous Decisions

- **Decision**: A separate report module for the conductor. **Rationale**: the `do-work` report has fixed section ids (ticks, work, git, selection) that the conductor does not have. **Alternatives considered**: widen `SectionId` and reuse `assembleReport`.
- **Decision**: Run the model with no comment permission in `--dry-run` and take its final message. **Rationale**: a run that cannot comment cannot post by mistake. **Alternatives considered**: let it post to a scratch target; stub the `gh` call.
- **Decision**: `inspectRunLock` gets a lock file parameter. **Rationale**: one classification for both locks, so the report and a tick agree. **Alternatives considered**: copy the function.
