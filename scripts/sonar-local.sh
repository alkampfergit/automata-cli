#!/usr/bin/env bash
# Run a local approximation of the SonarCloud quality gate, with no build and no token.
#   1. SonarJS rules (the same rules SonarCloud applies) -> code smells, bugs, vulnerabilities
#   2. jscpd with the Sonar thresholds                    -> duplication (gate limit: 3%)
#
# The gate looks at new code only, so by default the rules run on the files that differ
# from the base branch (default: origin/develop) and on uncommitted files.
#   scripts/sonar-local.sh                 changed files against origin/develop
#   scripts/sonar-local.sh --base <ref>    changed files against another ref
#   scripts/sonar-local.sh --all           every file in src
# Duplication always covers src and tests, because it is a ratio of the whole code.
# The rules cover src only: SonarCloud reports no rule finding in tests for this project.
# jscpd counts tokens differently from Sonar, so 150 tokens here matches the real result best.
# Exit code is 0 when both checks pass, 1 otherwise.
set -uo pipefail

cd "$(dirname "$0")/.."

BASE="origin/develop"
ALL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --all) ALL=1 ;;
    --base) BASE="${2:?--base needs a ref}"; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

PATHS=(src tests)
RULE_PATHS=(src)
DUPLICATION_LIMIT=3
status=0

if [ "$ALL" -eq 1 ]; then
  FILES=("${RULE_PATHS[@]}")
  echo "== SonarJS rules (all files) =="
else
  if ! git rev-parse --verify --quiet "$BASE" >/dev/null; then
    echo "Base ref '$BASE' not found. Fetch it or pass --base <ref>." >&2
    exit 2
  fi
  FILES=()
  while IFS= read -r file; do
    [ -f "$file" ] && FILES+=("$file")
  done < <({ git diff --name-only --diff-filter=d "$BASE"...HEAD; git diff --name-only --diff-filter=d HEAD; git ls-files --others --exclude-standard; } \
    | sort -u | grep -E '^src/.*\.(ts|tsx)$')
  echo "== SonarJS rules (${#FILES[@]} files changed against $BASE) =="
fi

if [ "${#FILES[@]}" -gt 0 ]; then
  if ! npx eslint --config eslint.sonar.config.js --report-unused-disable-directives-severity off "${FILES[@]}"; then
    status=1
  fi
fi

echo
echo "== Duplication (limit ${DUPLICATION_LIMIT}%) =="
if ! npx jscpd "${PATHS[@]}" \
  --min-tokens 150 --min-lines 10 \
  --threshold "$DUPLICATION_LIMIT" \
  --silent \
  --ignore "**/node_modules/**,**/fixtures/**"; then
  status=1
fi

echo
if [ "$status" -eq 0 ]; then
  echo "Local Sonar check: PASSED"
else
  echo "Local Sonar check: FAILED"
fi
exit "$status"
