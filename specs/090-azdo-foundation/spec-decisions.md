# Planning Decisions
- Absent `remoteType` semantics stay per call site (`isExplicitGitHub` for `implement-next`/`do-work`); alternative, one global default, would change GitHub behaviour.
- Prerequisite check takes an injectable runner; alternative, mocking `node:child_process`.
