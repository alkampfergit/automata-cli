# The automata harness

automata turns a GitHub repository into a workspace an AI agent can work in unattended.

The model is simple:

> **Authorized people talk on issues. The agent answers. Cron makes it happen.**

A maintainer opens an issue and labels it. On its next tick, `automata do-work` notices that the newest message from an authorized account is newer than anything the agent has said, claims the issue, and runs a model to answer it. While there is no pull request the agent only *talks* — specification, plan, questions. When an authorized message says "go ahead and implement it", the agent opens a branch and a pull request, and from then on every turn is work on that branch: address the review comments, commit, push, reply. A human merges.

Nothing else triggers it. A comment from someone who is not on the authorized list has no effect at all — it cannot start a run and never reaches the model.

## Where to start

| Page | What it answers |
|---|---|
| [Concepts](Concepts.md) | Who the actors are, what counts as a message, and what makes the agent owe an answer. |
| [Issue-Lifecycle](Issue-Lifecycle.md) | What one issue looks like tick by tick, from description to merged pull request. |
| [Detection-Rules](Detection-Rules.md) | The exact rules, including the full turn decision table. |
| [Setup](Setup.md) | Getting from an empty container to a working `do-work --dry-run`, then to cron. |
| [Prompts](Prompts.md) | How to change the agent's behaviour, and where a skill gets named. |
| [Operations](Operations.md) | Running it for real: the lock, exit codes, and what the harness will never do. |
| [Troubleshooting](Troubleshooting.md) | Symptom → cause → fix. |
| [Roadmap](Roadmap.md) | What is deliberately not built yet, and why. |

For exact command options and output shapes, see the reference page [docs/do-work.md](../do-work.md).

## When not to use this

- **On a repository you cannot afford to have branches pushed to.** The agent commits and pushes on its own branches. It never pushes to the base branch and never merges, but it is a writer.
- **Outside a disposable environment.** `do-work` invokes the executor with permission prompts bypassed, because an unattended run cannot answer a prompt. It belongs in a VM or container you can throw away, not on your laptop.
- **For a one-off task.** Use `automata implement-next` or `automata execute-prompt` — they are the manual, single-purpose commands and they still work exactly as before. `do-work` shares nothing with them but low-level plumbing.
- **When you want the model to drive.** automata exists to make the *decision* of what to do next cheap and deterministic, so a model is only invoked to do actual work.

## Publishing this wiki

These pages live in the repository so they are reviewed in the same pull request as the behaviour they describe. The filenames are GitHub wiki page names, so the directory can be published as-is:

```bash
git clone https://github.com/<owner>/<repo>.wiki.git /tmp/wiki
cp docs/wiki/*.md /tmp/wiki/
cd /tmp/wiki && git add -A && git commit -m "Sync wiki from docs/wiki" && git push
```
