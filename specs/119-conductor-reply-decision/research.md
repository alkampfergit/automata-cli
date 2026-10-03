# Research

## Autonomous Decisions

- **Decision**: Reuse `agentAnsweredAfter`, called per allowed user with the agent's newest message as the marker. **Rationale**: the swapped roles need the same "answered after" test, and `do-work` already owns it. **Alternatives considered**: `decideWork` with swapped `Participants` (supports only one answering account); a new comparison.
- **Decision**: Normalise issue and PR into one `Conversation` shape. **Rationale**: one rule, no per-kind branches. **Alternatives considered**: separate issue and PR functions.
