---
name: blocks-release-deployment
description: "Trigger and inspect SELISE Blocks Release builds/deploys entirely through `blocks release *` — never raw fetch/curl; there is no SDK path (Release has no `@seliseblocks/client` namespace). Covers `release deploy` (auto-resolves the repo, verifies branch matches environment), `release status`/`builds get` (build lookup by id), and `builds list` (list builds for a repo). Use for 'deploy/trigger a release', 'check build status', 'list recent builds'. Always `--dry-run` before `--yes`. No artifact-upload capability — deploy triggers a configured pipeline only."
---

# blocks-release-deployment

This skill's content lives at [`.codex/skills/blocks-release-deployment/SKILL.md`](../../../.codex/skills/blocks-release-deployment/SKILL.md).

**Read that file now and follow it.** Its relative links (`flows/`, sibling files) resolve from that directory, not this one.

This stub exists so Claude Code discovers the skill. It holds no guidance of its own and must never be given any — the `.codex` copy is the single source of truth, and a second copy would drift.
