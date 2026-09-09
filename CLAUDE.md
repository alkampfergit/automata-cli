All instructions are in @AGENTS.md use that file for instructions.
All skills live in .claude/skills/ — that is the single source of truth.
.agents/skills/ contains only symlinks into it, so Codex sees the same set;
regenerate them with `bash scripts/link-claude-skills.sh` after adding a skill.
Never add a real skill directory under .agents/skills/.
