# rebase open pull requests onto their base

**Branch**: `feature/165-rebase-prs` | **Date**: 2026-10-25 | **Spec**: [spec.md](specs/165-rebase-prs/spec.md)

Closes #128

## Summary

`automata git rebase-prs` brings every open pull request up to date with its base branch. A clean rebase is pushed with a lease. On a conflict the configured model resolves it; if that fails the branch stays as it was and the pull request is labelled `rebase-blocked`.

## What's New

- Pending.
