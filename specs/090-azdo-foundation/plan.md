# Plan: Azure DevOps foundation
New `src/remote/{backend,originUrl,azdoPrerequisites}.ts`; call sites in `gitService.ts`, `getReady.ts`,
`doWork.ts`, `executePrompt.ts` use the selector. Pure modules untouched. Tests in `tests/unit/`. Docs rewrite.
