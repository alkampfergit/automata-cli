# Plan

`composePromptWithinBudget` in `src/github/workPrompt.ts` renders the prompt, and when it is over budget finds by
bisection the smallest number of oldest non-new messages to drop. `doWork.ts` uses it in `planRun` (dry run) and
`processItem` (refusal through `refuseBeforeRun`). The setting is added to `configStore.ts`, validation in
`doWork.ts` and `config set` in `commands/config.ts`.
