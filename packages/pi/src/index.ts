/**
 * context-bart for pi — a Smart Zone / Dumb Zone context-window meter.
 *
 * A pi-native take on https://github.com/alejandrok5/context-bart. Upstream is a
 * statusline binary that walks a host transcript to guess used tokens; inside pi
 * we get that for free from `ctx.getContextUsage()` (already compaction-aware),
 * so this extension focuses on what a statusline binary can't do: live refresh
 * on every session event, an optional widget above the editor, zone-crossing
 * nags, and runtime config via `/bart`.
 *
 * Install: this file lives in ~/.pi/agent/extensions/context-bart/, so pi
 * auto-discovers it. `/reload` picks up edits.
 */

import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import {
	type BartConfig,
	COMPACT_HINT,
	computeMeter,
	configPaths,
	DEFAULT_CONFIG,
	type Display,
	loadConfig,
	type Meter,
	renderLine,
	ZONE_COLOR,
	ZONE_LABEL,
} from "./meter.ts";

const KEY = "context-bart";
const UPDATE_THROTTLE_MS = 400;

export default function (pi: ExtensionAPI) {
	let cfg: BartConfig = DEFAULT_CONFIG;
	let lastZone: Meter["zone"] | undefined;
	let lastPaintedAt = 0;
	let nagged = false;

	const overridePath = () => join(homedir(), CONFIG_DIR_NAME, "agent", "context-bart.json");

	function reloadConfig(ctx: ExtensionContext) {
		const paths = configPaths(ctx.cwd, CONFIG_DIR_NAME);
		// Project-local config is only honored for trusted projects.
		cfg = loadConfig(ctx.isProjectTrusted() ? paths : paths.slice(0, 2));
	}

	function clear(ctx: ExtensionContext) {
		ctx.ui.setStatus(KEY, undefined);
		ctx.ui.setWidget(KEY, undefined);
	}

	function paintFor(ctx: ExtensionContext) {
		if (cfg.color === "never") return undefined;
		const theme = ctx.ui.theme;
		if (!theme) return undefined;
		return (color: "success" | "warning" | "error" | "dim", text: string) => theme.fg(color, text);
	}

	function refresh(ctx: ExtensionContext, opts: { throttle?: boolean } = {}) {
		if (!ctx.hasUI) return;
		if (cfg.display === "off") {
			clear(ctx);
			return;
		}
		if (opts.throttle) {
			const now = Date.now();
			if (now - lastPaintedAt < UPDATE_THROTTLE_MS) return;
			lastPaintedAt = now;
		}

		const usage = ctx.getContextUsage();
		const meter = usage
			? computeMeter(
					{ tokens: usage.tokens, contextWindow: usage.contextWindow, modelId: ctx.model?.id },
					cfg,
				)
			: undefined;

		if (!meter) {
			// Unknown usage (fresh session, or right after compaction before the
			// next response). Degrade to a quiet placeholder instead of lying.
			const paint = paintFor(ctx);
			const text = paint ? paint("dim", "context: —") : "context: —";
			if (cfg.display === "status" || cfg.display === "both") ctx.ui.setStatus(KEY, text);
			else ctx.ui.setStatus(KEY, undefined);
			if (cfg.display === "widget" || cfg.display === "both") ctx.ui.setWidget(KEY, [text]);
			else ctx.ui.setWidget(KEY, undefined);
			lastZone = undefined;
			nagged = false;
			return;
		}

		const paint = paintFor(ctx);
		const line = renderLine(meter, paint);

		ctx.ui.setStatus(KEY, cfg.display === "status" || cfg.display === "both" ? line : undefined);

		if (cfg.display === "widget" || cfg.display === "both") {
			const lines = [line];
			if (meter.zone !== "smart") {
				lines.push(paint ? paint(ZONE_COLOR[meter.zone], COMPACT_HINT) : COMPACT_HINT);
			}
			ctx.ui.setWidget(KEY, lines);
		} else {
			ctx.ui.setWidget(KEY, undefined);
		}

		// Nag once per entry into the Dumb Zone; re-arm when we drop back to smart.
		if (meter.zone === "smart") nagged = false;
		if (cfg.nag && meter.zone === "dumb" && lastZone !== "dumb" && !nagged) {
			nagged = true;
			ctx.ui.notify(`${ZONE_LABEL.dumb} (${meter.percent.toFixed(0)}%) — ${COMPACT_HINT}`, "warning");
		}
		lastZone = meter.zone;
	}

	// ---------------------------------------------------------------- lifecycle

	pi.on("session_start", async (_event, ctx) => {
		reloadConfig(ctx);
		lastZone = undefined;
		nagged = false;
		refresh(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => clear(ctx));

	// Cheap refreshes on anything that can move the needle.
	for (const event of [
		"turn_start",
		"turn_end",
		"message_end",
		"tool_execution_end",
		"agent_settled",
		"model_select",
		"session_compact",
		"session_tree",
	] as const) {
		pi.on(event, async (_e, ctx) => refresh(ctx));
	}

	// Streaming updates: throttled so the status bar doesn't thrash.
	pi.on("message_update", async (_event, ctx) => refresh(ctx, { throttle: true }));

	// ----------------------------------------------------------------- command

	const onOff = (arg: string | undefined, current: boolean) =>
		arg === undefined ? !current : /^(on|true|yes|1)$/i.test(arg);

	function persist(ctx: ExtensionContext) {
		try {
			writeFileSync(overridePath(), `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
		} catch (err) {
			ctx.ui.notify(`context-bart: could not save config (${(err as Error).message})`, "error");
		}
	}

	pi.registerCommand("bart", {
		description: "Context meter: /bart [off|status|widget|both] [zones S D] [window N|auto] …",
		handler: async (args, ctx) => {
			const [sub, ...rest] = args.trim().split(/\s+/).filter(Boolean);

			switch (sub) {
				case undefined: {
					const usage = ctx.getContextUsage();
					const meter = usage
						? computeMeter(
								{ tokens: usage.tokens, contextWindow: usage.contextWindow, modelId: ctx.model?.id },
								cfg,
							)
						: undefined;
					const state = meter
						? `${renderLine(meter)} (zones ${cfg.zones.smart}/${cfg.zones.dumb}, display ${cfg.display})`
						: `context usage unknown yet (display ${cfg.display})`;
					ctx.ui.notify(state, "info");
					return;
				}

				case "off":
				case "status":
				case "widget":
				case "both":
					cfg.display = sub as Display;
					persist(ctx);
					refresh(ctx);
					ctx.ui.notify(`context-bart display: ${sub}`, "info");
					return;

				case "zones": {
					const smart = Number(rest[0]);
					const dumb = Number(rest[1]);
					if (!(smart > 0 && dumb > smart && dumb < 100)) {
						ctx.ui.notify("usage: /bart zones <smart> <dumb>  e.g. /bart zones 30 40", "error");
						return;
					}
					cfg.zones = { smart, dumb };
					persist(ctx);
					refresh(ctx);
					ctx.ui.notify(`context-bart zones: ${smart}% / ${dumb}%`, "info");
					return;
				}

				case "window": {
					if (rest[0] === "auto" || rest[0] === "null") cfg.windowTokens = null;
					else {
						const n = Number(rest[0]);
						if (!(n > 0)) {
							ctx.ui.notify("usage: /bart window <tokens|auto>", "error");
							return;
						}
						cfg.windowTokens = Math.floor(n);
					}
					persist(ctx);
					refresh(ctx);
					ctx.ui.notify(`context-bart window: ${cfg.windowTokens ?? "auto"}`, "info");
					return;
				}

				case "ascii":
				case "tokens":
				case "model":
				case "nag": {
					const field = { ascii: "ascii", tokens: "showTokens", model: "showModel", nag: "nag" }[
						sub
					] as "ascii" | "showTokens" | "showModel" | "nag";
					cfg[field] = onOff(rest[0], cfg[field]);
					persist(ctx);
					refresh(ctx);
					ctx.ui.notify(`context-bart ${sub}: ${cfg[field] ? "on" : "off"}`, "info");
					return;
				}

				case "reload":
					reloadConfig(ctx);
					refresh(ctx);
					ctx.ui.notify("context-bart config reloaded", "info");
					return;

				default:
					ctx.ui.notify(
						"/bart [off|status|widget|both] | zones S D | window N|auto | ascii|tokens|model|nag [on|off] | reload",
						"error",
					);
			}
		},
	});
}
