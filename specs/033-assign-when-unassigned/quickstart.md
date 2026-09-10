# Quickstart: verifying the assignment rule

## Unit level

```sh
npm test                      # builds first, then runs the whole suite
npx vitest run tests/unit/workDetection.test.ts tests/unit/ghWorkService.test.ts
npm run lint                  # see the note below
```

`npm run lint` is rewritten by the RTK hook into a whole-repo ESLint run that reports
pre-existing errors outside `src/`. Read the real gate with `rtk proxy npm run lint` or
`npx eslint src/`.

## Dry run against a real repository

```sh
npm run build
cd "$(mktemp -d)"
mkdir .automata && cat > .automata/config.json <<'JSON'
{ "remoteType": "gh", "agentUser": "<agent-login>", "allowedUsers": ["<maintainer>"],
  "issueDiscoveryTechnique": "label", "issueDiscoveryValue": "automated" }
JSON
GH_REPO=<owner>/<repo> node /workspaces/automata-cli/dist/index.js do-work --dry-run
```

Read the per-item header:

```
  Assignment   would assign issue to <agent> · would assign pull request #12 to <agent>
```

and confirm the closing line still says nothing was assigned. Then check the three
states by hand:

| Set up | Expected plan text |
|---|---|
| issue with no assignee | `would assign issue to <agent>` |
| issue assigned to anyone | `issue already assigned` |
| build turn, pull request with no assignee | `would assign pull request #N to <agent>` |
| build turn, pull request already assigned | `pull request already assigned` |

## Live check

On a scratch issue with no assignee, run one real tick and confirm with:

```sh
gh issue view <n> --json assignees
gh pr view <m> --json assignees
```

Then assign the issue to a human, remove the agent, and confirm the next tick leaves
the assignee list untouched.

## Advisory-failure check

Authenticate `gh` as an account without write access (or point `GH_REPO` at a
repository you cannot write) and confirm the tick prints
`warning: could not assign …` and still reaches its normal outcome and exit code.
