#!/usr/bin/env bash
set -u -o pipefail

cd /workspaces/automata-cli || exit 1
exec /usr/bin/zsh -lic 'exec automata do-work --silent'
