# Research

## Decision: keep `conductReply` and post inside the run callback
Rationale: the before/after verification, the `run-failed` and `posted-nothing` outcomes and the callers' handling
stay the same; only what `run` does changes. Alternatives considered: a new outcome type for "post failed" (more code,
same exit behaviour).

## Decision: the conductor adds the marker
Rationale: the marker drives the reply count and the rebase and CI-fix dedup; the model must not be able to lose it.
Alternatives considered: keep asking the model to write it (loses the guarantee).
