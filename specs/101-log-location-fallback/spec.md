# Feature Specification: Operation log location fallback

**Branch**: `feature/101-log-location-fallback` | **Issue**: #101

## Problem
In a devcontainer the parent of the checkout (`/workspaces`) is not writable by the container user, so `do-work`
cannot write its operation logs and `do-work --check` exits 1 although ticks succeed.

## Requirements
- FR-1: When the parent of the working directory is writable, logs stay there (unchanged).
- FR-2: Otherwise logs go to `<os.tmpdir()>/automata`, created on demand.
- FR-3: Writers, readers and `--check` share one resolver, so they always agree.

## Assumptions
- [AUTO] Fallback vs. always-tmp: chose fallback because it keeps existing workspace-shared logs working and fixes the read-only case.
- [AUTO] Not configurable, matching the existing "fixed location" design.
