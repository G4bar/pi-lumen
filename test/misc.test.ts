import { detectNerdFonts, resolveIcons, thinkIcon } from "../src/statusline/icons.ts";
import { describe, expect, it } from "vitest";
import { DEFAULTS, resolveConfig } from "../src/config.ts";
import { isStampData, stampLabel } from "../src/stamp.ts";
import { exitCodeOf, outputLines } from "../src/tools/bash.ts";
import { diffStats } from "../src/tools/edit-write.ts";
import { oneLine, plural } from "../src/tools/format.ts";

describe("config", () => {
	it("defaults when nothing is set", () => {
		expect(resolveConfig(undefined, undefined)).toEqual(DEFAULTS);
	});
	it("merges partial settings, then state overrides, ignoring wrong types", () => {
		const c = resolveConfig({ placement: "above", quota: { enabled: false }, tools: { previewLines: "x" }, inlineStatusKeys: ["a", 1] }, { placement: "below" });
		expect(c.placement).toBe("below");
		expect(c.quota).toEqual({ enabled: false, ttlMs: 90_000 });
		expect(c.tools.previewLines).toBe(40);
		expect(c.inlineStatusKeys).toEqual(["a"]);
	});
	it("rejects bad enums and clamps ttl", () => {
		const c = resolveConfig({ placement: "left", icons: "x", quota: { ttlMs: 1 }, git: { statusTtlMs: 1 } }, null);
		expect(c.placement).toBe("below");
		expect(c.icons).toBe("auto");
		expect(c.quota.ttlMs).toBe(15_000);
		expect(c.git.statusTtlMs).toBe(250);
	});
	it("does not mutate DEFAULTS", () => {
		resolveConfig({ tools: { previewLines: 5 } }, undefined);
		expect(DEFAULTS.tools.previewLines).toBe(40);
	});
});

describe("stamp data", () => {
	it("validates entries", () => {
		expect(isStampData({ v: 1, role: "user", ts: 1 })).toBe(true);
		expect(isStampData({ v: 2, role: "user", ts: 1 })).toBe(false);
		expect(isStampData({ v: 1, role: "x", ts: 1 })).toBe(false);
		expect(isStampData(null)).toBe(false);
	});
	it("labels with optional duration", () => {
		const ts = Date.UTC(2026, 0, 1, 10, 0, 0);
		expect(stampLabel({ v: 1, role: "assistant", ts, dur: 3200 }, "UTC")).toBe("10:00:00 · 3s");
		expect(stampLabel({ v: 1, role: "assistant", ts, prev: ts - 86_400_000 }, "UTC")).toBe("2025-12-31 · 10:00:00".replace("2025-12-31", "2026-01-01"));
	});
});

describe("tool helpers", () => {
	it("parses bash exit codes and output lines", () => {
		const out = "a\nb\n\nCommand exited with code 2";
		expect(exitCodeOf(out, true)).toBe(2);
		expect(exitCodeOf("ok", false)).toBe(0);
		expect(exitCodeOf("boom", true)).toBe(1);
		expect(outputLines(out)).toEqual(["a", "b"]);
		expect(outputLines("")).toEqual([]);
	});
	it("counts diff lines", () => {
		expect(diffStats("+1 a\n-2 b\n 3 c\n+4 d\n--- x\n+++ y")).toEqual({ added: 2, removed: 1 });
	});
	it("one-line + plural", () => {
		expect(oneLine("a\n  b")).toBe("a b");
		expect(oneLine("x".repeat(200)).length).toBe(110);
		expect(plural(1, "line")).toBe("1 line");
		expect(plural(2, "line")).toBe("2 lines");
	});
});

describe("nerd icons", () => {
	const env = (e: Record<string, string>): NodeJS.ProcessEnv => e;
	it("auto follows the terminal heuristic and the env overrides; explicit modes win", () => {
		expect(detectNerdFonts(env({ TERM_PROGRAM: "WezTerm" }))).toBe(true);
		expect(detectNerdFonts(env({ GHOSTTY_RESOURCES_DIR: "/x" }))).toBe(true);
		expect(detectNerdFonts(env({ TERM: "xterm-256color" }))).toBe(false);
		expect(detectNerdFonts(env({ TERM_PROGRAM: "WezTerm", POWERLINE_NERD_FONTS: "0" }))).toBe(false);
		expect(detectNerdFonts(env({ LUMEN_NERD_FONTS: "1" }))).toBe(true);
		expect(resolveIcons("auto", env({ TERM_PROGRAM: "kitty" }))).toBe("nerd");
		expect(resolveIcons("none", env({ TERM_PROGRAM: "kitty" }))).toBe("none");
		expect(resolveIcons("nerd", env({}))).toBe("nerd");
	});
	it("thinking level glyphs: one per level, none for off/max", () => {
		expect(thinkIcon("high")).toBe("\uF111 ");
		expect(thinkIcon("off")).toBe("");
		expect(thinkIcon("max")).toBe("");
	});
});
