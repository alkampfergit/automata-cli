# Operation log location fallback

Closes #101

## Summary
`do-work` logs to `automata/` under the system temp directory when the parent directory is not writable, so the health check no longer degrades in devcontainers.

## Testing
Unit tests for both resolver branches; `npm test && npm run lint` green.
