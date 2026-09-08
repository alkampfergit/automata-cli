#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/.claude/skills"
TARGET_DIR="$ROOT_DIR/.agents/skills"
BACKUP_DIR="$ROOT_DIR/.agents/.claude-skill-backups"

if [[ ! -d "$SOURCE_DIR" ]]; then
  printf 'Source directory not found: %s\n' "$SOURCE_DIR" >&2
  exit 1
fi

shopt -s nullglob
skill_dirs=("$SOURCE_DIR"/*)
if (( ${#skill_dirs[@]} == 0 )); then
  printf 'No Claude skills found in %s\n' "$SOURCE_DIR" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
linked=0

for skill_dir in "${skill_dirs[@]}"; do
  [[ -d "$skill_dir" ]] || continue

  skill_name="$(basename "$skill_dir")"
  target="$TARGET_DIR/$skill_name"
  relative_source="../../.claude/skills/$skill_name"

  if [[ -L "$target" ]]; then
    rm "$target"
  elif [[ -e "$target" ]]; then
    mkdir -p "$BACKUP_DIR"
    backup="$BACKUP_DIR/$skill_name"
    if [[ -e "$backup" || -L "$backup" ]]; then
      printf 'Backup already exists for %s: %s\n' "$skill_name" "$backup" >&2
      exit 1
    fi
    mv "$target" "$backup"
    printf 'Backed up %s to %s\n' "$skill_name" "$backup"
  fi

  ln -s "$relative_source" "$target"
  printf 'Linked %s -> %s\n' "$target" "$relative_source"
  linked=$((linked + 1))
done

if (( linked == 0 )); then
  printf 'No Claude skill directories were linked.\n' >&2
  exit 1
fi

printf 'Linked %d Claude skill(s) for Codex.\n' "$linked"
