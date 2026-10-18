## Planning Decisions
- Detect from the output, no pre-flight check: cheaper and cannot be wrong. Alternative: check on every tick.
- Post once through a marker in the comment, checked on the same thread: no extra state file. Alternative: a state file.
- Skip the remaining items after the failure: they would fail the same way.
