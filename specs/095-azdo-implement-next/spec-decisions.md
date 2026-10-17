# Spec Decisions: implement-next in Azure DevOps mode

**Branch**: `feature/095-azdo-implement-next`
**Date**: 2026-10-17
**Spec**: specs/095-azdo-implement-next/spec.md
**Plan**: specs/095-azdo-implement-next/plan.md
**Research**: specs/095-azdo-implement-next/research.md

## Planning Decisions

- **Closed items**: dropped on the client. **Rationale**: `--state` takes one state. **Alternatives considered**: one call per open state.
- **PR wiring**: through `RemoteWriteService`. **Rationale**: #93 built it for this. **Alternatives considered**: azdo branches in `getReady.ts`.
- **Comment reference**: an opaque string. **Rationale**: URL for GitHub, comment id for Azure DevOps. **Alternatives considered**: a tagged object.
