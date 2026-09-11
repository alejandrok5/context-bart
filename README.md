# Context Bart
[![CI](https://github.com/alejandrok5/context-bart/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/alejandrok5/context-bart/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/context-bart.svg)](https://www.npmjs.com/package/context-bart)
[![node](https://img.shields.io/node/v/context-bart.svg)](https://www.npmjs.com/package/context-bart)
[![license](https://img.shields.io/npm/l/context-bart.svg)](LICENSE)

> A Smart Zone / Dumb Zone context-window meter for Claude Code, OpenCode, Codex, and other AI coding agents.

![Context Bart, three zones across the session lifecycle](docs/demo.svg)


When you're talking to a long-context model, the first ~30% of the window is the **Smart Zone**, the model reasons reliably, follows instructions, and doesn't hallucinate. Push past ~40% and you enter the **Dumb Zone**: attention fragments, instructions get dropped, and "lost-in-the-middle" failures climb. `context-bart` puts that threshold front-and-center in your terminal so you know when to `/compact` or start a fresh session before quality degrades.

## Features

- **Single-line meter**: with a 10-segment progress bar, percentage, and zone label.
- **Color tiers**: green (0–29%), yellow (30–39%), red (40%+). Toggle via the `color` field in [config](#configuration).
- **Multi-host**: adapters for Claude Code, OpenCode, Codex, and a generic env-var fallback.
- **Zero dependencies**: pure Node.js stdlib (`fs`, `child_process`). Node 18+.
- **Auto window detection**: 1M when the model id is tagged `[1m]`, the host sets `exceeds_200k_tokens`, or observed usage tops 200k; 200k otherwise. Pin a specific window via `windowTokens` in [config](#configuration).
- **Extras**: model name, raw tokens, git branch (annotated with worktree name when you're in a linked worktree, e.g. `feat-x@worktree_3`), session cost.
- **Crash-safe**: any unexpected input degrades to a fallback line instead of breaking your status bar.

## Why not just write my own?

The [Claude Code statusline docs](https://code.claude.com/docs/en/statusline) hand you the contract, a JSON payload on stdin, your script's stdout becomes the bar, plus a few minimal examples. `context-bart` is what you'd end up writing if you sat down to ship a good one. The non-obvious things it solves:

- **The transcript walk.** Sum `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` from the latest assistant turn, stopping at `compact_boundary` markers so the bar visibly drops after `/compact`. The docs examples don't compute used context at all.
- **Window detection.** Claude Code reports `model.id: "claude-opus-4-7"` for 1M-tier sessions, the `[1m]` suffix isn't always there. `context-bart` reads `exceeds_200k_tokens` and auto-grows when observed usage tops 200k, so you never see `205% · 410k/200k`.
- **A defensible threshold.** Green / yellow / red at 30 / 40 % comes from the [lost-in-the-middle research](https://arxiv.org/abs/2307.03172), not picked from a hat.
- **Speed.** ~40 ms cold, zero deps. Shell-pipe statuslines that fan out to `git`, `jq`, and `node` land at 200–400 ms, noticeable every refresh.
- **Portability.** OpenCode and Codex send different payloads; switch tools, the bar follows.

If you want a multi-line bar, embedded `gh` / weather / etc., or anything that isn't a context meter, the docs page is your starting point. `context-bart` is purpose-built for the "am I about to enter the Dumb Zone?" question.

## Install

One line per host:

```bash
# Claude Code
npx context-bart install claude

# OpenCode
npx context-bart install opencode

# Codex (prints the wire-up block — Codex has no central config to patch)
npx context-bart install codex
```

Each `install` subcommand resolves an absolute command path, merges a `statusLine` (or `statusline`) block into the host's config file, and backs up the previous file to `.bak`. It's idempotent — re-running it overwrites only the bart-managed key, leaving every other setting intact. Pass `--dry-run` to preview the change without writing.

Prefer to install the binary first? Either path works — `install <host>` records whichever invocation it was launched with:

```bash
# npm install (puts `context-bart` on your $PATH)
npm install -g context-bart
context-bart install claude

# git clone (no build step; bin/context-bart.js runs as-is)
git clone https://github.com/alejandrok5/context-bart.git ~/context-bart
node ~/context-bart/bin/context-bart.js install claude
```

For the manual JSON snippets, the env-fallback mode, or troubleshooting, see the per-host docs:

- **[Claude Code](docs/install-claude-code.md)**
- **[OpenCode](docs/install-opencode.md)**
- **[Codex / generic](docs/install-codex.md)**

After running the installer, restart your host so it picks up the new statusline config.

### pi

pi gets its own native extension instead of a statusline shim — it exposes compaction-aware context
usage to extensions, so there's no transcript to walk:

```bash
pi install npm:pi-context-bart
```

See **[packages/pi](packages/pi/README.md)** for the `/bart` runtime commands, widget mode, and
zone-crossing nags.

### Updates

`context-bart` does a once-a-day, fire-and-forget check against the npm registry. When a newer version is available, a dim `↑0.2.1` segment is appended to the bar, that's your cue to run `npm update -g context-bart` (or `git pull` if you cloned). The check runs in a detached background process so it never delays a status-bar refresh; results are cached in `${XDG_CACHE_HOME:-~/.cache}/context-bart/latest.json` (or `%LOCALAPPDATA%\context-bart\` on Windows). Opt out entirely with `"updateCheck": false` in your [config file](#configuration).

## Configuration

All user preferences live in a single JSON file. The file is optional — without it you get the defaults.

Drop a `config.json` at:

- Linux / macOS: `$XDG_CONFIG_HOME/context-bart/config.json` (default: `~/.config/context-bart/config.json`)
- Windows: `%APPDATA%\context-bart\config.json`

Every field is optional; missing fields fall through to the defaults. Invalid values are silently dropped (the bar still renders).

```json
{
  "zones": { "smart": 30, "dumb": 40 },
  "windowTokens": null,
  "ascii": false,
  "updateCheck": true,
  "color": "auto"
}
```

| Field | Default | What it does |
| --- | --- | --- |
| `zones.smart` | `30` | Smart→approaching threshold (% of window). Must be in (0, 100) and less than `zones.dumb`. |
| `zones.dumb` | `40` | approaching→Dumb threshold (% of window). |
| `windowTokens` | `null` | Pin the context window size (e.g. `200000`, `1000000`). `null` keeps auto-detection. |
| `ascii` | `false` | Force ASCII glyphs (`[#####-----]`) instead of Unicode (`[▰▰▰▰▰▱▱▱▱▱]`). Auto-on regardless when `LANG` is non-UTF-8 (terminal-capability detection isn't a preference). |
| `updateCheck` | `true` | Set to `false` to disable the once-a-day npm version check. |
| `color` | `"auto"` | `"never"` disables ANSI color; `"auto"` and `"always"` enable it. The bar still renders correctly when piped to a non-TTY consumer (Claude Code captures the output that way by design). |

### Env vars used by host adapters

The following env vars are *not* user preferences — they're how the env-fallback and Codex adapters receive per-invocation runtime data from their host. You only set these if you're wiring up a host that drives the bar through env vars rather than a stdin JSON payload.

| Env var | Used by | What it carries |
| --- | --- | --- |
| `CONTEXT_BART_MODEL_ID` | env adapter | Model id. |
| `CONTEXT_BART_MODEL_NAME` | env adapter | Display name. |
| `CONTEXT_BART_USED_TOKENS` | env adapter | Used tokens count. |
| `CONTEXT_BART_WINDOW_TOKENS` | env adapter | Context window size. |
| `CONTEXT_BART_COST_USD` | env adapter | Cumulative cost. |
| `CONTEXT_BART_CWD` | env adapter | Working dir for git branch lookup (defaults to `$PWD`). |
| `CONTEXT_BART_TRANSCRIPT_PATH` | env adapter | JSONL transcript to parse. |
| `CODEX_*`, `OPENCODE_*` | Codex / OpenCode adapters | Host-specific runtime fields; see the per-host install docs. |

## How "used tokens" is computed

- **Claude Code**: walks the JSONL transcript at `transcript_path` (passed in by Claude Code) from the bottom up, finds the most recent assistant message with a `usage` block, and sums `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`. That's the model's actual context size at the last turn. After `/compact`, the walk stops at the `compact_boundary` marker and reports `0` until the next assistant turn writes fresh usage — so the bar visibly resets the moment you compact.
- **OpenCode**: reads `usage.total_tokens` (or `input_tokens + output_tokens`) directly from the payload.
- **Codex**: reads env vars or a nested `codex.usage` payload.
- **env fallback**: trusts `CONTEXT_BART_USED_TOKENS` directly.

## Why the 30 / 40 % thresholds?

The cutoffs aren't picked from a hat — they track converging findings from a stack of long-context benchmarks published between 2023 and 2026. The qualitative cliff is real, and it tends to land earlier than the advertised window suggests:

- **["Lost in the Middle" (Liu et al., TACL 2024)](https://arxiv.org/abs/2307.03172)** — the original result. Recall on multi-document QA drops 30%+ when the relevant document sits in the middle of the context vs. at the edges, even on models marketed as long-context. ([ACL Anthology version](https://aclanthology.org/2024.tacl-1.9/))
- **[RULER (Hsieh et al., COLM 2024)](https://arxiv.org/abs/2404.06654)** — only about half of models advertising a 32K window actually hold up at 32K once you move past needle-in-a-haystack to multi-hop reasoning. "Effective context" is routinely a fraction of the marketing number.
- **[NoLiMa (Modarressi et al., ICML 2025)](https://arxiv.org/abs/2502.05167)** — 11 of 12 long-context models fall below 50% of their short-context baseline by 32K tokens. GPT-4o drops from 99.3% → 69.7%. ([Adobe Research repo](https://github.com/adobe-research/NoLiMa))
- **[Found in the Middle (Hsieh et al., 2024)](https://arxiv.org/abs/2406.16008)** — pins the root cause on a U-shaped attention bias from RoPE positional encoding, which is baked into most modern LLMs. The cliff is architectural, not just a training artifact.
- **[Context Length Alone Hurts LLM Performance Despite Perfect Retrieval (Oct 2025)](https://arxiv.org/abs/2510.05381)** — even when the relevant passage is handed to the model perfectly, scores degrade 14–85% as surrounding input length grows. Length itself is the variable.
- **[Intelligence Degradation in Long-Context LLMs (2026)](https://arxiv.org/abs/2601.15300)** — identifies a critical threshold around 40–50% of max context length where F1 scores collapse catastrophically (e.g. Qwen2.5-7B: 0.55 → 0.30, a 45% drop).
- **[MRCR v2 8-needle leaderboard (2026)](https://llm-stats.com/benchmarks/mrcr-v2-(8-needle))** — OpenAI's multi-fact retrieval benchmark is the de-facto 2026 yardstick for the 1M tier. Even the leaders bleed double-digit points moving from 128K to 1M: Claude Opus 4.6 drops 93% → 76%, Gemini 3.1 Pro ~85% → ~70%. [2026 industry analysis](https://ofox.ai/blog/long-context-llm-benchmarks-200k-tokens-2026/) puts effective utilization at **50–65% of advertised window** for multi-hop work, and notes that the gap between "advertised" and "effective" widens to 30–60 points past 200K tokens ([reality check](https://tokenmix.ai/blog/1m-token-context-reality-check-2026)).

Numbers vary by model and task, but the cliff consistently lands in the **30–50% of window** band — and the 1M tier hasn't changed that, it's just stretched the absolute token count where degradation starts. `context-bart` warns yellow at 30% and red at 40% — deliberately conservative, since the alternative is realizing you're past the cliff only after a bad answer. If you're working exclusively on a model with an unusually flat degradation profile, raise the bar via `"zones"` in your [config file](#configuration), or fork `src/render.js` (`pickZone`) — it's ~10 lines.

## Add a new host adapter

Adapters live in `src/adapters/`. The contract is two functions:

```js
module.exports = {
  name: 'my-host',
  detect(stdin, env) {
    // return true if this payload/env looks like yours
  },
  parse(stdin, env) {
    // return a normalized payload:
    // { modelId, modelDisplayName, usedTokens, windowSize, costUsd, cwd, transcriptPath }
  },
};
```

Register it in `src/detect.js` (order matters — first detector wins). Add a test in `test/adapters.test.js`. Submit a PR.

## Development

```bash
npm test    # runs node --test on the test/ dir
npm run smoke   # pipes an empty payload to verify the fallback path

# pi package (Node 22+)
npm test --prefix packages/pi
```

The repo holds two publishable artifacts: the `context-bart` CLI at the root (released on `v*` tags)
and the `pi-context-bart` pi extension in `packages/pi` (released on `pi-v*` tags).

No dependencies to install. See [CONTRIBUTING.md](CONTRIBUTING.md) for
the release process.

## License

MIT. See [LICENSE](LICENSE).


----
[![bart](https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExZHBjbWFvMTYxamJidHZnZWF5d2V6Z2k0cmQzbDNlZjBnYTB5MjBkaiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/xT5LMItTmALdTn0Hx6/giphy.gif)]
