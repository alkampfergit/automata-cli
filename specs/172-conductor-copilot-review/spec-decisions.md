# Planning Decisions

**Plan**: [plan.md](specs/172-conductor-copilot-review/plan.md)

- Settings and round records go in the gitignored watch state file: it is machine state with an atomic writer. Alternatives: `config.json`, a second file.
- One registry drives validation, `list`, errors and docs. Alternative: per-command switches.
- The round decision is a pure function of facts. Alternative: inline logic with `gh` calls.
- Pending review is read from `reviewRequests`. Alternative: compare review timestamps.
- A failed request ends the rounds of that PR. Alternative: retry every tick.
