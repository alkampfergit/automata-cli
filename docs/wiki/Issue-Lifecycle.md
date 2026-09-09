# The lifecycle of an issue

One issue, from a sentence to a merged pull request, tick by tick. Everything the agent does is visible in the GitHub UI — that is on purpose, so a human can always see where things stand.

```
   ┌────────────────────────────────────────────────────────────────────┐
   │  DISCUSSION                              no linked open PR        │
   │                                                                   │
   │  human writes ──▶ agent replies ──▶ human replies ──▶ …           │
   │        ▲                                     │                    │
   │        └─────────────────────────────────────┘                    │
   │                                                                   │
   │                  human says "implement it"                        │
   └──────────────────────────────┬────────────────────────────────────┘
                                  │  agent opens branch + PR (Closes #N)
                                  ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │  BUILD                                   linked open PR exists    │
   │                                                                   │
   │  reviewer comments ──▶ agent fixes, pushes, replies ──▶ …         │
   │        ▲                                     │                    │
   │        └─────────────────────────────────────┘                    │
   └──────────────────────────────┬────────────────────────────────────┘
                                  │  a human merges (automata never does)
                                  ▼
                               DONE
```

The transition between the two states is not a flag anyone sets. It is the existence of a pull request that closes the issue.

---

## Step 1 — A maintainer opens the issue

Alice (in `allowedUsers`) opens issue #42, describes what she wants, and adds the `automated` label.

**Visible state:** open, labelled `automated`, no assignee, no comments.

## Step 2 — The first tick

`do-work` lists issues with the label, finds #42, and sees no linked pull request and no message from the agent at all. The newest authorized message — the description itself — is therefore unanswered.

It checks out `develop`, assigns #42 to `automata-bot`, posts `automata do-work: working…`, and runs the model with the discussion prompt: reply on the issue, do not touch the code.

The model posts a specification proposal. `do-work` re-reads the issue, sees the agent's answer, and **deletes the marker**.

**Visible state:** assigned to `automata-bot`; two comments — the agent's proposal, and nothing else. The `working…` comment is gone.

## Step 3 — Alice replies

She corrects a couple of assumptions.

**Visible state:** her comment is now the newest, and it is newer than the agent's reply. The agent owes an answer again.

## Step 4 — More discussion ticks

Each tick: marker in, model runs, agent replies, marker out. The thread reads as an ordinary back-and-forth between two participants. Still no code, still no branch.

Note what a tick between steps 3 and 4 does when Alice has not replied yet: it finds the agent's own reply as the newest message, decides there is nothing to do, and exits 0 — no model call. The loop is quiet by default.

## Step 5 — Alice gives the go-ahead

> "Plan looks good, go ahead and implement it."

## Step 6 — The escalating tick

`do-work` still sees no pull request, so this is a discussion turn — but the discussion prompt says: unless a new message explicitly asks you to implement, in which case create a branch off the base branch, implement, and open a pull request whose body contains `Closes #42`.

The model does exactly that. Afterwards `do-work` checks the current branch for a pull request and confirms it closes #42. If the model had forgotten the closing reference, `do-work` adds it — that link *is* the state machine, and without it the issue would sit in discussion forever.

**Visible state:** issue #42 assigned, with an agent comment saying what was built; pull request #57 open from `feature/042-…`, body containing `Closes #42`.

## Step 7 — A review

Alice leaves an inline comment on `src/index.ts:12`: "rename this variable".

## Step 8 — The build tick

`do-work` finds #42, resolves its linked open pull request #57, and sees an unresolved review thread whose newest comment is from an authorized human.

It checks out `feature/042-…` and fast-forwards it, posts the marker **on the pull request**, and runs the model with the build prompt: work on this branch, address the new messages and the listed threads, commit and push, reply on the pull request, never merge.

The model fixes the code, pushes, and replies in the thread. `do-work` re-reads the pull request — including the thread comments — sees the agent's reply, and deletes the marker.

**Visible state:** a new commit on the branch; the agent's reply in the review thread. The thread is still marked unresolved, and that is fine: resolving is Alice's action, and because the agent spoke last the thread no longer counts as needing an answer.

## Step 9 — More rounds

Repeat step 7 and 8 for as long as review takes. If Alice comments on the *issue* rather than the pull request while #57 is open, that also produces a build turn — one turn, with both surfaces' new messages in the prompt, rather than two agents racing on one branch.

## Step 10 — A human merges

automata never merges and never closes an issue. Alice merges #57; GitHub closes #42 because of the closing reference.

**Visible state:** #57 merged, #42 closed. The next tick skips #42 as closed.

---

## What the thread looks like at the end

Only the participants' real messages: Alice's description, the agent's proposals, her corrections, the agent's implementation summary, the review exchange. No `working…` comments survive — unless some run produced no answer, in which case exactly one marker remains, saying so and asking for a reply. That is the signal to look at it.

## The edge that trips people up

If a pull request is **merged or closed** while the issue is still open, `do-work` treats the issue as having no pull request, so the next authorized message produces a *discussion* turn. That is deliberate: the branch has landed or gone, so pushing to it is wrong, and a discussion turn lets the humans say what should happen next.
