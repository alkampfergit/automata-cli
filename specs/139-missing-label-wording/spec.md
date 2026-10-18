# Spec: Create a missing label for every gh wording

Issue: #139

## Problem
`addLabel` creates a missing label only when `isMissingLabelError` knows the gh message. gh can also print
`failed to update <url>: 'conductor-blocked' not found`. The label is then not created and the tick fails.

## Requirements
- FR-1: `isMissingLabelError` accepts `'<name>' not found` when `<name>` is the requested label.
- FR-2: A "not found" for any other name is not a missing label.
- FR-3: `addLabel` passes the label name, so it creates the label once and retries.

## Assumptions
- [AUTO] Anchoring: chose the requested label name because it keeps a missing issue from triggering label creation.
- [AUTO] The permission problem in the issue is out of scope; it is a settings matter.
