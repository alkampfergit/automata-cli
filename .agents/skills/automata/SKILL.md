---
name: automata
description: >
  Use when working through the automata CLI in this repository. Two modes.
  Autonomous: `automata do-work` runs one tick of the GitHub-driven loop —
  it finds the open issues whose newest message from an authorized account
  the agent has not answered, on the issue or on its pull request, and
  answers them. Manual: pick up an issue with `automata implement-next`,
  monitor PR status and CI with `automata git get-pr-info`, inspect
  unresolved review threads with `automata git get-pr-comments`, address
  reviewer feedback, and clean up a merged branch with
  `automata git finish-feature`. Also use when the user asks how automata
  works, which mode applies, or why a `do-work` tick did or did not act.
---

# Automata Skill

automata has two modes, and picking the wrong one wastes work.

| Mode | Command | Use when |
|---|---|---|
| **Autonomous** | `automata do-work` | The repository is being driven through GitHub: issues are labelled and the agent answers them on a schedule. This is the normal mode for this repository. |
| **Manual** | `implement-next`, `execute-prompt`, `git *` | You are doing one specific thing by hand: claiming a single issue, fixing Sonar findings, answering review comments on the branch you are on. |

They share no logic. `do-work` decides *what* to answer next and then invokes a
model once per item; the manual commands each do one step and assume a human
chose it.

Prefer `automata ...` when the CLI is installed. Inside this repository,
`npm exec -- automata ...` is a safe fallback, and `node dist/index.js ...`
works after `npm run build`.

---

## Mode 1: the autonomous loop (`do-work`)

Read `docs/do-work.md` for the option reference and `docs/wiki/` for the
process — `docs/wiki/Detection-Rules.md` in particular, which has the full turn
decision table.

### Preconditions

`do-work` refuses the whole tick (exit 1) unless all of these hold:

- `remoteType` is `gh`
- `issueDiscoveryTechnique` and `issueDiscoveryValue` are set
- `allowedUsers` is non-empty and `agentUser` is set
- every configured `doWork` prompt resolves
- **`gh` is not authenticated as an account listed in `allowedUsers`**

That last one is the one to remember. Everything the agent posts is attributed
to whoever `gh` is authenticated as. If that account may instruct the agent, the
agent's own marker comment reads as a new instruction and every tick answers the
previous tick's marker forever. `do-work` refuses rather than start.

### Always look before running

```bash
automata do-work --dry-run
```

This prints the decision and the reason for every candidate issue, then a
summary and the exact command that would be launched for each item — including
the fully assembled prompt — and changes nothing: nothing assigned, nothing
posted, no branch touched, no model invoked.

Use it whenever you are asked why a tick did or did not act on an issue (the
reason string names the rule that fired), or to inspect what the model would
actually receive before a prompt change is committed.

`--dry-run --json` gives the same information as data, with the raw argv under
`runs[].args` and the prompt under `runs[].prompt` — the easier form for
diffing a prompt change.

### Running a tick

```bash
automata do-work                    # one tick over every issue needing an answer
automata do-work --issue 42         # restrict the tick to one issue
automata do-work --max-runs 1       # cap the model runs this tick
automata do-work --with codex       # override the configured executor (claude is the default)
automata do-work --model o3         # override the configured model for that executor
automata do-work --silent           # only the final summary from Claude
```

### What a tick does per item

1. checks out the branch the turn needs — the base branch for a discussion turn,
   the pull request's head branch for a build turn;
2. assigns the issue to `agentUser` if it is not already assigned;
3. posts a `working…` marker comment;
4. invokes the executor;
5. reconciles the marker — deletes it if the agent posted an answer, otherwise
   updates it in place to say what happened;
6. after a discussion turn only, ensures any new pull request closes the issue.

### The two turns

| Turn | When | Boundary |
|---|---|---|
| `issue-discuss` | The issue has **no** linked open pull request | Reply on the issue; do not touch the code — unless a NEW message explicitly asks for implementation, in which case branch, implement, and open a pull request whose body contains `Closes #N`. |
| `pr-work` | The issue **has** a linked open pull request | Work on that branch, address the feedback, commit, push, reply on the pull request. Never merge, never push to the base branch. |

The link is GitHub's closing reference, so **opening a pull request that closes
the issue is what moves an issue from discussion into implementation**. If a
pull request exists without that reference, the issue stays stuck in
discussion — `do-work` repairs it, but check `Closes #N` is present if an issue
seems stuck.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Tick completed, every item answered. Also "nothing to do", `--dry-run`, and "another instance is running". |
| `1` | Precondition failed; nothing attempted. |
| `2` | Tick ran, but an item was `skipped`, `failed`, `deferred`, or `answered-no-reply`. |

Exit 2 is degraded, not broken. `answered-no-reply` means the run posted
nothing, so a human must reply before that issue moves again — the loop will not
retry it on its own.

### Changing the agent's behaviour

The turn instructions are prompts in configuration, and that text is where a
skill gets named — automata itself has no concept of a skill.

- `.automata/do-work-issue-discuss.md`
- `.automata/do-work-pr-work.md`

Editing those files changes behaviour with no code change and no release. The
contract for what automata supplies versus what the prompt owns is in
`docs/wiki/Prompts.md`. A configured prompt that cannot be resolved **fails the
tick** rather than silently falling back to the built-in default.

### If you are the model invoked by a tick

You are already inside a `do-work` turn. Do not run `do-work`, `implement-next`
or `execute-prompt` — that would launch an agent inside an agent, and the run
lock would refuse anyway. Do the work described in your prompt and post your
reply on the surface it names.

---

## Mode 2: the manual commands

Use these when a human has chosen the single step to perform. They are
unaffected by `do-work` and behave exactly as they always have.

Preconditions: `remoteType` is `gh`, `gh` is installed and authenticated, and
`.automata/config.json` has `issueDiscoveryTechnique` and `issueDiscoveryValue`.

Not available in `azdo` mode: `do-work`, `implement-next`,
`git get-pr-comments`, `execute-prompt check-issue`. See `docs/azdo-gap.md`.

### Pick up one issue

```bash
automata implement-next --query-only    # inspect without claiming
automata implement-next                 # claim and invoke the executor
automata implement-next --no-claude     # claim, then implement manually
```

Useful flags — note these were renamed in feature 022, so `--codex` and
`--verbose` no longer exist:

- `--with claude|codex` — choose the executor (default `claude`)
- `--silent` — suppress step-by-step output (the inverse of the old `--verbose`)
- `--model <id>` — pass a model identifier through
- `--yolo` — bypass permission prompts
- `--take-first` — pick the first match instead of prompting
- `--limit <n>` — how many issues to fetch (default 10)
- `--ask-copilot-review` — request a Copilot review on the resulting PR
- `--json` — machine-readable issue data

If you are already the coding agent, `--query-only` or `--no-claude` is safest:
it avoids launching another agent inside the agent.

### Check PR status and CI

```bash
automata git get-pr-info
automata git get-pr-info --json
automata git get-pr-info --wait-finish-checks
```

Check symbols: `✓` passed · `✗` failed · `●` pending · `○` skipped or neutral.
Failure details and URLs are printed when available. Use
`--wait-finish-checks` as the default merge-readiness gate.

### Review unresolved PR comments

```bash
automata git get-pr-comments
automata git get-pr-comments --json
```

Each block is one unresolved review thread with author, file and line.
`No open comments.` means nothing is unresolved. Run this *after* review, not
before. Expected loop: read comments → fix → test → push →
`get-pr-info --wait-finish-checks` → repeat.

### Targeted prompt workflows

```bash
automata execute-prompt sonar --with claude          # fix SonarCloud findings on this PR
automata execute-prompt fix-comments --with claude   # address unresolved review threads
automata execute-prompt check-issue 42 --with claude # act on new messages on one issue
```

`sonar` and `fix-comments` are the right tools for **bot** reviewer feedback
(Copilot, SonarCloud). `do-work` ignores bots on purpose — they comment after
every push, so a loop that answered them would never settle.

#### Complete PR feedback monitoring

`automata git get-pr-comments` reports only unresolved inline review threads. It does
not include top-level PR conversation comments, review-submission bodies, or replies
beyond the first comment returned for a thread. A monitor must inspect all three
GitHub feedback surfaces read-only:

```bash
# Top-level PR conversation comments
gh api repos/<owner>/<repo>/issues/<N>/comments --paginate

# Review submissions and their summary bodies
gh api repos/<owner>/<repo>/pulls/<N>/reviews --paginate

# Inline review comments and replies
gh api repos/<owner>/<repo>/pulls/<N>/comments --paginate
```

Sort the combined results by `created_at` / `submitted_at` and compare them with the
previously processed comment/review IDs or timestamps. Surface every new human,
reviewer, Copilot, or bot item, including a newer owner comment; do not equate an
unchanged unresolved-thread count with no new feedback. Keep this monitoring pass
read-only unless the user separately authorizes fixes or PR comments.

### Finish a merged feature

```bash
automata git finish-feature
```

Intentionally strict. It requires: you are not on `develop`, the working tree is
clean, a PR exists for the branch, that PR is merged, and the remote tracking
branch is gone. Then it fetches with prune, checks out `develop`, pulls, and
deletes the local branch. Do not run it before the PR is merged.

---

## Agent guidance

- **Check which mode applies first.** If the repository is driven through
  GitHub issues, `do-work` is the entry point and the manual commands are
  escape hatches.
- **Always `--dry-run` before a real tick** when anything about the
  configuration or the queue is uncertain. It is free.
- **Never run `do-work` from inside a `do-work` turn.**
- When asked why an issue was not picked up, run `--dry-run` and read the
  reason rather than guessing; `docs/wiki/Detection-Rules.md` explains each one.
- When asked why the agent repeated itself or answered twice, suspect
  `agentUser` not matching the account `gh` posts as — that is the failure the
  identity guard exists to catch.
- `do-work` never merges, never closes an issue, and never pushes to the base
  branch. Do not ask it to; use the manual commands or do it yourself.
- If a command's flags do not match this document, trust `--help` and the
  `docs/<group>.md` page, and fix this file.
