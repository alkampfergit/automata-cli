# Research
## Decision: look the PR up with `pr list` before `pr comments --pr-number`
**Rationale**: a branch with no PR then yields `null` (the existing "No pull request found" error) rather than azdo's error, and other branches work too.
**Alternatives considered**: `pr comments` auto-detect (fails on zero/multiple matches with an azdo message).
## Decision: filter status and anchoring in automata as well as in azdo
**Rationale**: azdo flags do the work, but `active`/`pending` is the documented contract, so it is asserted locally against fixtures.
**Alternatives considered**: trust the flags alone (leaves the contract untested).
## Decision: exclude general threads
**Rationale**: GitHub review threads are always file-anchored; `PrComment.path` is required.
**Alternatives considered**: include them with an empty path (breaks the output shape).
