# Research
## Decision: keep absent-`remoteType` semantics per call site
**Rationale**: `implement-next`/`do-work` reject a missing key today; `selectBackend` defaults it to GitHub, so they use `isExplicitGitHub`.
**Alternatives considered**: one default everywhere — would change GitHub behaviour.
## Decision: injectable runner for prerequisites
**Rationale**: unit-testable without mocking `spawnSync`.
**Alternatives considered**: mock `node:child_process`.
