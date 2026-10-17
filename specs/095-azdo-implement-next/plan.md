# Plan: implement-next in Azure DevOps mode

- `src/remote/azdoWorkItems.ts` (new): `listWorkItems(technique, value, limit)` and `getWorkItem` shape; one `azdo` runner.
- `src/remote/writeService.ts` / `azdoWriteService.ts`: `postIssueComment` returns an edit reference; new
  `editIssueComment(issueNumber, ref, body)`. GitHub parses the URL with the existing `editComment`.
- `src/commands/getReady.ts`: backend switch for validation, discovery, claim and PR wiring; the issue shape stays
  `{number,title,body,url}`.
- `src/config/configStore.ts`: `AZDO_PR_INSTRUCTIONS` constant.
- `src/config/ConfigWizard.tsx`: azdo technique labels and title.
- Docs and changelog.
