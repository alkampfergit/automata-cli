# Concepts

## The actors

| Actor | Configured as | What it means |
|---|---|---|
| **Authorized accounts** | `allowedUsers` | The only people who can command the agent. Their messages trigger turns and are the only third-party text the model ever sees. |
| **The agent** | `agentUser` | The account the agent posts as. Its newest message is the line between "answered" and "not answered". |
| **Everyone else** | — | Ignored completely. Cannot trigger a turn, and never appears in a prompt. |

That third row is the important one. A public repository's issues can be commented on by anyone; if any comment could start an agent run, the trigger surface would be the whole internet. So the filter is not a convenience — it is the security boundary. It also means bot reviewers (Copilot, SonarCloud) are excluded by construction, which is deliberate: they post after every push, and a loop that answered them would never settle. Use `automata execute-prompt sonar` and `fix-comments` for bot feedback.

## The two surfaces

An issue's conversation can happen in two places, and the agent watches both:

- **The issue** — its description and its comments.
- **Its pull request** — the conversation comments, review bodies with text, and the comments inside review threads.

Each surface keeps its own boundary. The agent can be up to date on the issue and behind on the pull request, or the reverse.

## What counts as a message

Anything with an author, a body and a timestamp: an issue description, an issue comment, a pull-request comment, a review with a written summary, or a comment inside a review thread. A review with no body carries no message — only its inline comments do.

## The agent boundary

**The agent owes an answer on a surface when the newest message there from an authorized account is newer than the newest message from the agent.**

This is the whole trigger. Note what it does *not* involve: no state file, no database, no label to keep in sync. The boundary lives in the conversation itself, which means the behaviour is identical on your laptop, in a fresh container, and on a CI runner — nothing to carry between them.

Two details keep it from misbehaving:

- The comparison is **strict**, so a timestamp tie is not new. The agent's own messages can therefore never trigger it.
- The **issue description never acts as the boundary**, so an issue opened by the agent itself is still processed normally.

## The two turns

| Turn | When | What the agent does |
|---|---|---|
| **Discussion** (`issue-discuss`) | The issue has no linked open pull request | Talks. Specification, plan, questions — no code. Unless a new message explicitly asks for implementation, in which case it creates the branch and opens the pull request. |
| **Build** (`pr-work`) | The issue has a linked open pull request | Works on that pull request's branch: addresses the feedback, commits, pushes, replies. |

Which one applies is decided by a single observable fact — does an open pull request declare that it closes this issue? — so no intent classification and no extra model call is needed. The link is GitHub's own closing reference, the thing `Closes #42` in a pull request body produces. That is why **opening a pull request is what moves an issue from talking to building**: the state change is a side effect of the work itself, visible to everyone in the GitHub UI.

## Assignment and the marker: two different jobs

Both appear on the issue, and it is easy to assume they are redundant. They are not.

**Assignment** is the *visible claim*. When the agent first takes an issue it assigns the issue to itself, so anyone scanning the issue list can see it is taken without opening the thread. It is additive — an issue already triaged to a human keeps that person — and if it fails (say the agent account lacks write access) the turn runs anyway, with a warning. Assignment is signalling; it does not affect correctness.

**The marker** is the *boundary record*. Just before each model run the agent posts a `working…` comment. That comment is the agent's newest message, so while the run is in flight the boundary has already moved past the human's message. Without it, a run that crashed halfway would leave the human's message looking unanswered, and the next tick would answer it again — and again. So if the marker cannot be posted, the item is skipped and no model runs.

The marker is scaffolding, and it is cleaned up:

- **The agent posted an answer** → the marker is **deleted**. The real answer is newer and holds the boundary; the marker is just noise in a thread humans have to read.
- **The agent posted nothing** → the marker is **updated in place** to say the run finished or failed without an answer, and to ask for a reply.

Deleting is guarded by actually re-reading the surface, never by the executor's exit code — a run can exit non-zero after posting a perfectly good reply, and exit zero having posted nothing. And updating deliberately keeps the comment's creation time, so a run that produced nothing still holds the boundary and is **not** retried automatically. That is a choice, not an oversight: an unattended loop that retries a failing run on every firing would spend model calls forever on the same broken input. The updated marker text is how a human learns they need to step in.

So a finished, healthy conversation contains only human messages and real agent answers — no leftover `working…` comments — while every run that produced nothing has left exactly one marker explaining itself.

## A tick

One run of `automata do-work`. It takes the run lock, discovers the candidate issues, decides a turn for each, and processes every item that needs one — sequentially, one model run each — then exits. A tick with nothing to do costs a handful of API calls and no model calls at all.
