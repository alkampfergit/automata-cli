# PR Report: Operation log for `do-work`

**Branch**: `feature/033-operation-log`
**Date**: 2026-09-10
**Spec**: [specs/033-operation-log/spec.md](../../specs/033-operation-log/spec.md)

## Summary

An operator running `automata do-work` from cron has no durable record of the
loop: when it silently stops working there is nothing to look at, because cron's
output was discarded. This adds two plain-text diagnostic files in the directory
above the checkout — `automata-execution.log`, one line per invocation capped at
the newest 1000 lines, and `automata-work.log`, one record per invocation that
actually ran the executor, pruned to the last 30 days. Both are best-effort: if
the directory is not writable, or any write fails, the tick behaves exactly as
it does today.

## What's New

[TO BE COMPLETED IN PHASE 7]

## Testing

[TO BE COMPLETED IN PHASE 7]
