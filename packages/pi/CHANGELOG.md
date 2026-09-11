# Changelog

All notable changes to `pi-context-bart` (the pi extension). The `context-bart` CLI has its own
[CHANGELOG](../../CHANGELOG.md).

## 0.1.0

Initial release.

- Smart Zone / approaching / Dumb Zone context meter for pi, colored from the active pi theme.
- Token source is `ctx.getContextUsage()` — compaction-aware, no transcript walking.
- Refreshes on turn, message, tool result, compaction, tree navigation and model switch; streaming
  updates throttled to 400 ms.
- `display` modes: `off`, `status` (footer), `widget` (above the editor), `both`.
- One-shot notification on entering the Dumb Zone, re-armed after dropping back to the Smart Zone.
- `/bart` command for runtime config (`display`, `zones`, `window`, `ascii`, `tokens`, `model`,
  `nag`, `reload`), persisted to `~/.pi/agent/context-bart.json`.
- Config merged from `~/.config/context-bart/config.json` (shared with the CLI),
  `~/.pi/agent/context-bart.json`, and `<cwd>/.pi/context-bart.json` (trusted projects only).
- Unknown usage renders as a dim `context: —` instead of a fabricated number.
