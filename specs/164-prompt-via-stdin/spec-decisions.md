# Planning Decisions

**Plan**: [plan.md](specs/164-prompt-via-stdin/plan.md)

- One builder with `promptOn`: two builders can drift from the dry run. Alternative: a prompt-less variant.
- `feedStdin()` swallows stdin errors: `close` already reports an early exit. Alternative: reject from the error handler.
- Dry run prints `… < <tmp file>`: stays pasteable and equal to the real command. Alternative: two blocks.
- Remove the 96 KiB guard: no new limit; the executor reports its own. Alternative: raise it.
