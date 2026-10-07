# Research

## Decision: PR claim is a no-op
**Rationale**: no PR assignee in Azure DevOps. **Alternatives considered**: add agent as reviewer (votes on own work); throw (would break callers that claim best-effort).

## Decision: issue comment body in argv
**Rationale**: `azdo comments add` has no stdin/file option in 0.20.0; spawnSync without a shell avoids quoting. **Alternatives considered**: `set-md-field` on a history field (overwrites); skip (blocks the feature).

## Decision: interface plus GitHub wrapper in one seam
**Rationale**: "same signatures the gh callers use, selected through the seam". **Alternatives considered**: azdo module only (nothing selects it).

## Autonomous Decisions
See the `[AUTO]` entries in spec.md.
