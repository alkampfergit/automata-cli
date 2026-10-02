# Planning Decisions: Transcript-based reply recovery

- Reuse the second-opinion executor call: keeps model/effort/sandbox settings; alternatives were a tool-enabled rerun or a new spawn path.
- Verify with `analyseAnswer` on a re-read: same test as the normal check; alternative was trusting the POST response.
