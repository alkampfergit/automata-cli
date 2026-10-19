# Conductor: a blocked issue no longer hides its pull request

Closes #161

## Summary
A watched pull request is no longer silenced by its watched issue when that issue is `conductor-blocked` or at the reply limit. The pull request is decided on its own, so Copilot review threads get a reply. The "covered" line now says where replies are decided.

## Testing
Unit tests for the predicate and a command test for the blocked-issue case; `npm test`, `lint`, `typecheck` and `sonar:local` pass.
