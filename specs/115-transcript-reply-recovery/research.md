# Research

## Decision: reuse the second-opinion executor call
Rationale: it already honours executor, model, effort and the no-permission-bypass rule.
Alternatives considered: re-running `runClaude` with tools (could act twice); a new spawn path (duplication).

## Decision: verify by the existing answer analysis
Rationale: `analyseAnswer` on a re-read thread is the same test the normal check uses.
Alternatives considered: trusting the POST response (does not prove visibility).
