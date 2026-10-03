# Plan: Azure DevOps write adapter
- `src/remote/writeService.ts`: `RemoteWriteService` interface, GitHub adapter wrapping existing functions, `selectWriteService`.
- `src/remote/azdoWriteService.ts`: the azdo implementation (private `runAzdo` with stdin support).
- Tests: `tests/unit/azdoWriteService.test.ts`, `tests/unit/writeService.test.ts`.
- Docs: `docs/azdo-gap.md`; CHANGELOG is not touched (no user-visible change: nothing calls the adapter yet).
