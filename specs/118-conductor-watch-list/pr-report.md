# PR Report: conductor watch list

**Branch**: `feature/118-conductor-watch-list`
**Date**: 2026-10-02
**Spec**: specs/118-conductor-watch-list/spec.md

## Summary

Gives `automata conductor` a watch list of issues and pull requests, stored in `.automata/config.json`. The operator
manages it with `add`, `remove` and `list`; `add` also makes `do-work` pick the item up, and each tick drops items that
have closed or merged.

## What's New

TBD
