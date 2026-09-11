# pi-context-bart

A Smart Zone / Dumb Zone context-window meter for [pi](https://pi.dev) — the
[context-bart](https://github.com/alejandrok5/context-bart) idea, rebuilt as a native pi extension.

![context-bart in the pi status bar across three zones](https://raw.githubusercontent.com/alejandrok5/context-bart/main/packages/pi/docs/pi-demo.png)

Green below 30% (Smart Zone), yellow 30–39%, red at 40%+ (Dumb Zone) — thresholds from the
[lost-in-the-middle](https://arxiv.org/abs/2307.03172) result that long-context attention degrades
well before the window is full.

## Install

```bash
pi install npm:pi-context-bart
```

Then restart pi or run `/reload`. Try it without installing: `pi -e npm:pi-context-bart`.
Turn it off without uninstalling: `/bart off`.

## What's different from the CLI

The `context-bart` CLI is a statusline binary: each host hands it a JSON payload and it walks the
transcript JSONL, summing `input + cache_creation + cache_read` from the last assistant turn and
stopping at compact boundaries. Inside pi that work is already done — `ctx.getContextUsage()`
returns compaction-aware `{ tokens, contextWindow, percent }`. So this package drops the
adapter/transcript layer and adds what an external statusline process can't do:

| | `context-bart` CLI | `pi-context-bart` |
| --- | --- | --- |
| Token source | per-host transcript walk | `ctx.getContextUsage()` |
| Refresh | on host statusline tick | every turn, message, tool result, compaction, model switch (streaming updates throttled to 400 ms) |
| Placement | one status line | footer status, widget above the editor, or both |
| Zone crossing | passive color change | one-shot notification with a `/compact` nudge, re-armed when you drop back to the Smart Zone |
| Config | file only | file **plus** `/bart` at runtime, persisted |
| Color | own ANSI tiers | active pi theme (`success` / `warning` / `error`) |

## `/bart`

| Command | Effect |
| --- | --- |
| `/bart` | Show the current meter plus active zones/display |
| `/bart off` \| `status` \| `widget` \| `both` | Where the meter renders |
| `/bart zones 25 35` | Set smart/dumb thresholds (%) |
| `/bart window 1000000` \| `auto` | Pin or unpin the context window size |
| `/bart ascii` \| `tokens` \| `model` \| `nag` `[on\|off]` | Toggle glyph style, raw tokens, model id, zone nag |
| `/bart reload` | Re-read config files from disk |

Every setter writes the effective config to `~/.pi/agent/context-bart.json`, so runtime changes stick.

## Configuration

Files are merged in order, later wins:

1. `~/.config/context-bart/config.json` — shared with the CLI (`XDG_CONFIG_HOME` respected;
   `%APPDATA%\context-bart\config.json` on Windows)
2. `~/.pi/agent/context-bart.json` — pi-specific, written by `/bart`
3. `<cwd>/.pi/context-bart.json` — project-local, **only read in trusted projects**

```json
{
  "zones": { "smart": 30, "dumb": 40 },
  "windowTokens": null,
  "ascii": false,
  "segments": 10,
  "display": "status",
  "showTokens": true,
  "showModel": false,
  "nag": true,
  "color": "auto"
}
```

| Field | Default | What it does |
| --- | --- | --- |
| `zones.smart` | `30` | Smart→approaching threshold (% of window). In (0, 100) and below `zones.dumb`. |
| `zones.dumb` | `40` | approaching→Dumb threshold (% of window). |
| `windowTokens` | `null` | Pin the window size (e.g. `1000000`). `null` uses what pi reports. |
| `ascii` | `false` | Force `[#####-----]` instead of `[▰▰▰▰▰▱▱▱▱▱]`. Auto-on when `LANG`/`LC_ALL` isn't UTF-8. |
| `segments` | `10` | Bar width in segments (4–40). |
| `display` | `"status"` | `off`, `status`, `widget` (above the editor), or `both`. |
| `showTokens` | `true` | Show `90k/200k`. |
| `showModel` | `false` | Append the model id. |
| `nag` | `true` | Notify once on entering the Dumb Zone. |
| `color` | `"auto"` | `"never"` renders without theme colors. |

Every field is optional and invalid values are dropped silently (an inverted zone pair falls back to
the previous pair) — the bar always renders. Unknown usage (fresh session, or right after compaction
before the next response) renders as a dim `context: —` rather than a fabricated number.

## Layout

- `src/meter.ts` — pure config/zone/render logic, node stdlib only
- `src/index.ts` — pi wiring: events, status/widget, `/bart`
- `test/meter.test.ts` — `npm test` (Node 22+, uses `--experimental-strip-types`)

## License

MIT
