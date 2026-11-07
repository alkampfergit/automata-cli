# PR Report: clean-branches command

**Branch**: `feature/183-clean-branches`
**Date**: 2026-11-07
**Spec**: specs/183-clean-branches/spec.md

## Summary

`automata git clean-branches` removes the local branches that have no `origin` branch, and the `origin` branches
whose pull requests are all closed or merged. It prints the plan and asks before it deletes anything.

## What's New

<!-- completed in Phase 7 -->
