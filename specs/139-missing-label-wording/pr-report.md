# Create a missing label for every gh wording

## Summary
The conductor now creates the `conductor-blocked` label when gh reports it as `'conductor-blocked' not found`.

## What's New
- `isMissingLabelError` accepts that wording for the requested label; `addLabel` passes the name.

## Testing
- Unit tests for the helper and for `addLabel` (create once, then retry).
