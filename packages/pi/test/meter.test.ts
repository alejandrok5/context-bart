/**
 * Unit tests for the pure meter logic.
 *
 * Run: node --test --experimental-strip-types meter.test.ts
 * (from ~/.pi/agent/extensions/context-bart)
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	computeMeter,
	DEFAULT_CONFIG,
	formatTokens,
	mergeConfig,
	renderBar,
	renderLine,
	zoneFor,
} from "../src/meter.ts";

test("zoneFor respects thresholds", () => {
	const z = { smart: 30, dumb: 40 };
	assert.equal(zoneFor(0, z), "smart");
	assert.equal(zoneFor(29.9, z), "smart");
	assert.equal(zoneFor(30, z), "approaching");
	assert.equal(zoneFor(39.9, z), "approaching");
	assert.equal(zoneFor(40, z), "dumb");
	assert.equal(zoneFor(100, z), "dumb");
});

test("renderBar fills proportionally and clamps", () => {
	assert.equal(renderBar(0, 10, true), "[----------]");
	assert.equal(renderBar(35, 10, true), "[####------]");
	assert.equal(renderBar(100, 10, true), "[##########]");
	assert.equal(renderBar(250, 10, true), "[##########]");
	assert.equal(renderBar(50, 10, false), "[▰▰▰▰▰▱▱▱▱▱]");
});

test("formatTokens is compact", () => {
	assert.equal(formatTokens(999), "999");
	assert.equal(formatTokens(1500), "1.5k");
	assert.equal(formatTokens(76_000), "76k");
	assert.equal(formatTokens(1_400_000), "1.4M");
});

test("computeMeter returns undefined for unknown usage", () => {
	assert.equal(computeMeter({ tokens: null, contextWindow: 200_000 }, DEFAULT_CONFIG), undefined);
});

test("computeMeter builds segments and zone", () => {
	const m = computeMeter({ tokens: 84_000, contextWindow: 200_000 }, DEFAULT_CONFIG);
	assert.ok(m);
	assert.equal(m.zone, "dumb");
	assert.equal(m.segments[1], "42%");
	assert.equal(m.segments[2], "84k/200k");
	assert.equal(m.segments[3], "DUMB ZONE");
});

test("computeMeter never reports over 100% when the window under-reports", () => {
	const m = computeMeter({ tokens: 410_000, contextWindow: 200_000 }, DEFAULT_CONFIG);
	assert.ok(m);
	assert.equal(m.window, 410_000);
	assert.equal(m.percent, 100);
});

test("windowTokens pin wins over the reported window", () => {
	const cfg = mergeConfig(DEFAULT_CONFIG, { windowTokens: 1_000_000 });
	const m = computeMeter({ tokens: 100_000, contextWindow: 200_000 }, cfg);
	assert.ok(m);
	assert.equal(m.window, 1_000_000);
	assert.equal(m.zone, "smart");
});

test("mergeConfig drops invalid values and inverted zones", () => {
	const cfg = mergeConfig(DEFAULT_CONFIG, {
		zones: { smart: 80, dumb: 20 },
		segments: 999,
		display: "nonsense",
		ascii: "yes",
		nag: false,
	});
	assert.deepEqual(cfg.zones, DEFAULT_CONFIG.zones);
	assert.equal(cfg.segments, DEFAULT_CONFIG.segments);
	assert.equal(cfg.display, DEFAULT_CONFIG.display);
	assert.equal(cfg.ascii, false);
	assert.equal(cfg.nag, false);
});

test("mergeConfig accepts a valid zone pair and model toggle", () => {
	const cfg = mergeConfig(DEFAULT_CONFIG, { zones: { smart: 25, dumb: 35 }, showModel: true });
	assert.deepEqual(cfg.zones, { smart: 25, dumb: 35 });
	assert.equal(cfg.showModel, true);
});

test("renderLine is paint-agnostic and shows the model when enabled", () => {
	const cfg = mergeConfig(DEFAULT_CONFIG, { showModel: true, ascii: true });
	const m = computeMeter({ tokens: 20_000, contextWindow: 200_000, modelId: "sonnet-4" }, cfg);
	assert.ok(m);
	const line = renderLine(m);
	assert.equal(line, "[#---------] 10% · 20k/200k · Smart Zone · sonnet-4");
	const painted = renderLine(m, (c, t) => `<${c}>${t}`);
	assert.ok(painted.startsWith("<success>"));
	assert.ok(painted.includes("<dim>"));
});
