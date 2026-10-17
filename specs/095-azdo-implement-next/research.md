# Research

## Decision: filter closed work items on the client
Rationale: `azdo list-items --state` takes one state only. Alternatives considered: one call per open state (needs the process template's state names).

## Decision: reuse `RemoteWriteService` for PR wiring
Rationale: #93 built it for this; GitHub and Azure DevOps share one code path. Alternatives considered: azdo branches inside `getReady.ts`.

## Decision: comment edit reference is a string
Rationale: GitHub needs a URL, Azure DevOps a comment id; an opaque string keeps one signature. Alternatives considered: a tagged object.

## Autonomous Decisions
See `spec.md` Assumptions.
