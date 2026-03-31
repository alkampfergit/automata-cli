# Contract: automata git get-pr-info (checks extension)

## Command

```
automata git get-pr-info [--json]
```

## Human-readable output (default)

Existing lines unchanged, followed by a `Checks:` section:

```
PR:    #42
Title: My feature
State: OPEN
URL:   https://github.com/org/repo/pull/42
Checks:
  ✓ build
  ✓ lint
  ✗ test
    Details: 3 tests failed in src/foo.test.ts
  ● deploy (pending)
```

When no checks:
```
Checks: none
```

## JSON output (`--json`)

```json
{
  "number": 42,
  "title": "My feature",
  "state": "OPEN",
  "url": "https://github.com/org/repo/pull/42",
  "checks": [
    {
      "name": "build",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "description": "",
      "detailsUrl": "https://github.com/..."
    },
    {
      "name": "test",
      "status": "COMPLETED",
      "conclusion": "FAILURE",
      "description": "3 tests failed in src/foo.test.ts",
      "detailsUrl": "https://github.com/..."
    }
  ]
}
```

When no checks: `"checks": []`

## Exit codes

| Code | Meaning                              |
|------|--------------------------------------|
| 0    | Success                              |
| 1    | Error (gh failure, no PR found, etc) |
