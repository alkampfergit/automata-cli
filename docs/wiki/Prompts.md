# Prompts — how to change the agent's behaviour

automata does not know what a skill is. It assembles context and enforces a turn boundary; everything about *how* to do the work lives in a prompt you control. That is the whole extension mechanism: to change the agent's behaviour, edit a file in `.automata/` — no CLI release, no code change.

## The contract

Each turn's prompt is built from two parts, in this order:

```
┌──────────────────────────────────────────────┐
│  THE FRAME                                   │  ← yours, verbatim
│  the configured prompt for this turn kind    │
├──────────────────────────────────────────────┤
│  --- Context assembled by automata ---       │  ← automata's, guaranteed
│  Repository: acme/widget                     │
│  You are: automata-bot                       │
│  Turn: issue-discuss | pr-work               │
│  Base branch: develop                        │
│  Issue #42: <title>                          │
│  Issue URL: …                                │
│  [Pull request #57: <title>]                 │
│  [Pull request URL: …]                       │
│  [Branch: feature/042 (checked out, current)]│
│                                              │
│  New since your last message — this is what  │
│  you must answer:                            │
│    <the new messages, marked NEW>            │
│                                              │
│  Full conversation on the issue …            │
│  [Conversation on the pull request …]        │
│  [Unresolved review threads needing an       │
│   answer, with file and line]                │
│                                              │
│  Only the messages above exist. Anything     │
│  from other accounts has been withheld       │
│  deliberately — do not ask about it.         │
└──────────────────────────────────────────────┘
```

**automata guarantees** the context block: the identities, the branch state (the branch named is already checked out and up to date), the new messages, the filtered conversation, and the review threads. It also guarantees what is *absent* — nothing from an unauthorized account is ever included.

**Your frame is responsible for** everything else: what to do, what not to touch, where to reply, and which skill to use.

Because the frame comes first and verbatim, you can replace the instructions completely without losing or reordering any data.

## What the frame must cover

The turn boundary is the part not to get wrong, since it is what keeps a discussion turn from writing code.

**A discussion turn (`issue-discuss`)** should tell the model to:

- reply on the **issue**;
- not modify, create or delete any file, and not create a branch or pull request;
- **except** when a message marked `NEW` explicitly asks for implementation, in which case: branch off the base branch, implement, and open a pull request whose body contains `Closes #<issue>`;
- always post a reply — silence is indistinguishable from a crash, and produces a leftover marker.

That last exception is what moves an issue from talking to building. Removing it means the agent will discuss forever and never implement.

**A build turn (`pr-work`)** should tell the model to:

- work on the branch named in the context (already checked out and current);
- address every `NEW` message and every listed unresolved thread;
- commit and **push** to that branch;
- **not** merge the pull request and **not** push to the base branch;
- reply on the pull request, or in the review thread when the answer belongs to a specific comment;
- always post a reply.

## Setting a prompt

Inline, or as a `.md` file in `.automata/`:

```bash
automata config set do-work-prompt issue-discuss do-work-issue-discuss.md
automata config set do-work-prompt pr-work do-work-pr-work.md
```

The wizard (`automata config` → Prompts → *Do Work — Discuss* / *Do Work — PR*) pre-fills the built-in default so you can edit rather than start from scratch, and writes `.automata/do-work-issue-discuss.md` / `.automata/do-work-pr-work.md`.

File references follow the usual rules: a plain filename, no subdirectories, resolved inside `.automata/`.

> **An unresolvable prompt fails the tick.** If the file is missing or the path escapes `.automata/`, `do-work` exits 1 rather than falling back to the built-in default. On an unattended loop, quietly running instructions other than the ones you configured is worse than a refused tick.

## Worked example: naming a skill

The built-in defaults are self-contained and name no skill, so `do-work` runs correctly with nothing installed. Once you have skills in the environment, point at them:

`.automata/do-work-issue-discuss.md`

```markdown
Use the `github-issue-spec` skill.

You are the agent named in the context below, discussing a GitHub issue with the
people allowed to instruct you. Answer the messages marked NEW.

Do not modify, create or delete any file, and do not create a branch or a pull
request, UNLESS a message marked NEW explicitly asks you to implement the work.

If it does, use the `speckit-full` skill instead: create a branch off the base
branch named below, produce the spec and plan, implement, run the tests and the
linter, and open a pull request whose body contains `Closes #<issue number>`.

Otherwise reply on the issue only, and always post a reply.
```

`.automata/do-work-pr-work.md`

```markdown
Use the `github-pr-review-fix` skill.

Work on the branch named in the context below — it is already checked out and up
to date. Address every message marked NEW and every unresolved review thread
listed, following this project's conventions in AGENTS.md.

Run `npm test && npm run lint` before finishing. Commit and push to that branch.
Do not merge the pull request and do not push to the base branch.

Reply on the pull request with a short summary, or in the review thread when your
answer belongs to a specific comment. Always post a reply.
```

The executors load whatever skills are installed in the environment and will use one when the prompt names it. Which skills exist, and how they are distributed, is entirely outside automata's concern.

## Why it is built this way

Behaviour changes far more often than orchestration does. Keeping the instructions in a file means improving the agent is a text edit reviewed like any other, rather than a CLI release; and keeping automata ignorant of skills means it never depends on a plugin being installed, so a fresh container cannot silently do the wrong thing.
