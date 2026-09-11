/**
 * Pure rendering / config logic for the context-bart pi extension.
 *
 * Kept dependency-free (node stdlib only) so it can be unit-tested with
 * `node --test` without booting pi.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Zone = "smart" | "approaching" | "dumb";
export type Display = "off" | "status" | "widget" | "both";
export type ColorMode = "auto" | "always" | "never";

export interface BartConfig {
	zones: { smart: number; dumb: number };
	windowTokens: number | null;
	ascii: boolean;
	segments: number;
	display: Display;
	showTokens: boolean;
	showModel: boolean;
	nag: boolean;
	color: ColorMode;
}

export const DEFAULT_CONFIG: BartConfig = {
	zones: { smart: 30, dumb: 40 },
	windowTokens: null,
	ascii: false,
	segments: 10,
	display: "status",
	showTokens: true,
	showModel: false,
	nag: true,
	color: "auto",
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";

/** Merge one raw JSON object over a config, silently dropping invalid values. */
export function mergeConfig(base: BartConfig, raw: unknown): BartConfig {
	if (!raw || typeof raw !== "object") return base;
	const r = raw as Record<string, unknown>;
	const next: BartConfig = { ...base, zones: { ...base.zones } };

	const z = r.zones as Record<string, unknown> | undefined;
	if (z && typeof z === "object") {
		if (isNum(z.smart) && z.smart > 0 && z.smart < 100) next.zones.smart = z.smart;
		if (isNum(z.dumb) && z.dumb > 0 && z.dumb < 100) next.zones.dumb = z.dumb;
	}
	// smart must stay below dumb; otherwise keep the pair we already had.
	if (next.zones.smart >= next.zones.dumb) next.zones = { ...base.zones };

	if (r.windowTokens === null) next.windowTokens = null;
	else if (isNum(r.windowTokens) && r.windowTokens > 0) next.windowTokens = Math.floor(r.windowTokens);

	if (isBool(r.ascii)) next.ascii = r.ascii;
	if (isBool(r.showTokens)) next.showTokens = r.showTokens;
	if (isBool(r.showModel)) next.showModel = r.showModel;
	if (isBool(r.nag)) next.nag = r.nag;
	if (isNum(r.segments) && r.segments >= 4 && r.segments <= 40) next.segments = Math.floor(r.segments);
	if (r.display === "off" || r.display === "status" || r.display === "widget" || r.display === "both") {
		next.display = r.display;
	}
	if (r.color === "auto" || r.color === "always" || r.color === "never") next.color = r.color;

	return next;
}

/**
 * Config file search order (later wins):
 *   1. ~/.config/context-bart/config.json   (shared with the upstream CLI)
 *   2. ~/.pi/agent/context-bart.json        (pi-specific overrides)
 *   3. <cwd>/.pi/context-bart.json          (project-local, trusted projects only)
 */
export function configPaths(cwd: string, piConfigDirName = ".pi"): string[] {
	const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
	const appdata = process.env.APPDATA;
	const shared =
		process.platform === "win32" && appdata
			? join(appdata, "context-bart", "config.json")
			: join(xdg, "context-bart", "config.json");
	return [
		shared,
		join(homedir(), piConfigDirName, "agent", "context-bart.json"),
		join(cwd, piConfigDirName, "context-bart.json"),
	];
}

export function loadConfig(paths: string[]): BartConfig {
	let cfg = DEFAULT_CONFIG;
	for (const p of paths) {
		try {
			cfg = mergeConfig(cfg, JSON.parse(readFileSync(p, "utf8")));
		} catch {
			// missing or malformed file: keep what we have
		}
	}
	return cfg;
}

export function zoneFor(percent: number, zones: BartConfig["zones"]): Zone {
	if (percent >= zones.dumb) return "dumb";
	if (percent >= zones.smart) return "approaching";
	return "smart";
}

export const ZONE_LABEL: Record<Zone, string> = {
	smart: "Smart Zone",
	approaching: "approaching",
	dumb: "DUMB ZONE",
};

/** Theme color name per zone (matches pi's ThemeColor union). */
export const ZONE_COLOR: Record<Zone, "success" | "warning" | "error"> = {
	smart: "success",
	approaching: "warning",
	dumb: "error",
};

/** True when the terminal can't be trusted with Unicode block glyphs. */
export function forceAscii(env: NodeJS.ProcessEnv = process.env): boolean {
	const lang = env.LC_ALL || env.LC_CTYPE || env.LANG;
	if (!lang) return false;
	return !/utf-?8/i.test(lang);
}

export function renderBar(percent: number, segments: number, ascii: boolean): string {
	const filled = Math.max(0, Math.min(segments, Math.round((percent / 100) * segments)));
	const [on, off] = ascii ? ["#", "-"] : ["▰", "▱"];
	return `[${on.repeat(filled)}${off.repeat(segments - filled)}]`;
}

export function formatTokens(n: number): string {
	if (n < 1000) return `${n}`;
	if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
	return `${(n / 1_000_000).toFixed(1)}M`;
}

export interface MeterInput {
	tokens: number | null;
	contextWindow: number;
	modelId?: string;
}

export interface Meter {
	percent: number;
	tokens: number;
	window: number;
	zone: Zone;
	/** Uncolored segments, in display order. */
	segments: string[];
}

/**
 * Window resolution: an explicit `windowTokens` pin wins, otherwise use what pi
 * reports, growing to the observed usage if a model under-reports its window.
 */
export function computeMeter(input: MeterInput, cfg: BartConfig): Meter | undefined {
	const tokens = input.tokens;
	if (tokens === null || !Number.isFinite(tokens)) return undefined;

	let window = cfg.windowTokens ?? input.contextWindow;
	if (!Number.isFinite(window) || window <= 0) window = 200_000;
	if (tokens > window) window = tokens;

	const percent = Math.min(100, (tokens / window) * 100);
	const zone = zoneFor(percent, cfg.zones);

	const segments = [
		renderBar(percent, cfg.segments, cfg.ascii || forceAscii()),
		`${percent.toFixed(0)}%`,
	];
	if (cfg.showTokens) segments.push(`${formatTokens(tokens)}/${formatTokens(window)}`);
	segments.push(ZONE_LABEL[zone]);
	if (cfg.showModel && input.modelId) segments.push(input.modelId);

	return { percent, tokens, window, zone, segments };
}

/** One-line status text. `paint` lets the caller apply theme colors. */
export function renderLine(
	meter: Meter,
	paint: (color: "success" | "warning" | "error" | "dim", text: string) => string = (_c, t) => t,
): string {
	const color = ZONE_COLOR[meter.zone];
	const [bar, pct, ...rest] = meter.segments;
	return [paint(color, `${bar} ${pct}`), paint("dim", rest.join(" · "))].filter(Boolean).join(" · ");
}

export const COMPACT_HINT = "past the Smart Zone — consider /compact or /new";
