# PR Report: conductor loop safety

**Branch**: `feature/122-conductor-loop-safety`
**Date**: 2026-10-06
**Spec**: specs/122-conductor-loop-safety/spec.md

## Summary

The conductor now stops on its own, so two unattended agents cannot answer each other for ever. It caps the replies on
each watched item, lets the model say that a person must take over, and leaves closed and merged items alone.

## What's New

- **Reply limit**: `conductor.maxRepliesPerItem` (default 5), counted from a marker the replies carry (`src/conductor/loopSafety.ts`).
- **Needs a human**: the model ends its output with `NEEDS-HUMAN: <reason>`; the tick applies the `conductor-blocked` label (`addLabel`) and posts nothing. A labelled item gets no reply until the label is removed.
- **Decision**: skip reasons `limit` and `blocked` in `decideConductorReply`; `--check` and `--dry-run` show and obey them.
- **Closed or merged items**: unchanged rule, now covered by a test.
- **Docs**: `docs/conductor.md#loop-safety`, `docs/config.md`, `CHANGELOG.md`.

## Testing

- **Unit**: counting, parsing, validation, decision order, instructions, `addLabel` (including creating a missing label).
- **Command**: limit, default, bad setting, blocked label, needs-a-human labelling and its failure, closed item, dry run.
- `npm test && npm run lint` pass.

## Notes

- A reply without the marker is not counted; the posting instruction asks for it on every reply.
- There is no `config set` key for the limit; edit the JSON.

Closes #122
