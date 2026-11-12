import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { cacheColor, contextColor, quotaColor, rainbow } from "../src/statusline/colors.ts";
import { buildLine, fitLine } from "../src/statusline/layout.ts";
import { formatTokens, type RenderData } from "../src/statusline/segments.ts";

// Minimal theme double: tags colors so tests can see them, adds no width.
const theme = {
	fg: (c: string, t: string) => `\x1b[3${c.length % 8}m${t}\x1b[39m`,
	bold: (t: string) => t,
	getThinkingBorderColor: () => (t: string) => t,
} as unknown as RenderData["theme"];

const data = (over: Partial<RenderData> = {}): RenderData => ({
	theme,
	icons: "none",
	provider: "anthropic",
	modelName: "Claude Opus 4",
	thinkingLevel: "high",
	context: { tokens: 84_000, window: 200_000, percent: 42 },
	spend: { mode: "oauth", quota: { fiveHour: 37, sevenDay: 12 }, stale: false },
	cache: { kind: "rate", percent: 81 },
	tps: 62,
	cwd: "/home/x/lumen",
	branch: "main",
	git: { staged: 1, unstaged: 2, untracked: 0 },
	extStatuses: ["LSP ready"], // the layout still draws whatever it is given; session filters by inlineStatusKeys
	...over,
});

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("status line", () => {
	it("renders every segment at full width", () => {
		const line = plain(buildLine(data(), 0, "│"));
		expect(line).toContain("anthropic · Opus 4");
		expect(line).toContain("think:high");
		expect(line).toContain("84k/200k 42%");
		expect(line).toContain("5h 37% · 7d 12%");
		expect(line).toContain("CH 81% · 62 tok/s");
		expect(line).toContain("lumen");
		expect(line).toContain("main *2 +1");
		expect(line).toContain("LSP ready");
	});

	it.each([20, 40, 60, 80, 120, 200])("never overflows at %i columns", (w) => {
		for (const over of [{}, { extStatuses: [] }, { branch: null }, { modelName: "x".repeat(80) }, { context: { tokens: null, window: 1_000_000, percent: null } }]) {
			const line = fitLine(data(over as Partial<RenderData>), w);
			expect(visibleWidth(line)).toBeLessThanOrEqual(w);
		}
	});

	it("drops segments in priority order", () => {
		const d = data();
		const levels = [0, 1, 2, 3, 4, 5, 6].map((l) => plain(buildLine(d, l, "│")));
		expect(levels[1]).not.toContain("LSP");
		expect(levels[2]).not.toContain("*2");
		expect(levels[2]).toContain("main");
		expect(levels[3]).not.toContain("lumen");
		expect(levels[4]).not.toContain("tok/s");
		expect(levels[5]).not.toContain("5h");
		expect(levels[6]).not.toContain("main");
		for (const l of levels) {
			expect(l).toContain("Opus 4");
			expect(l).toContain("think:high");
			expect(l).toContain("84k/200k");
		}
	});

	it("keeps model/think/context and truncates the model last", () => {
		const line = plain(fitLine(data({ modelName: "A very long model name indeed" }), 45));
		expect(line).toContain("think:high");
		expect(line).toContain("84k/200k");
		expect(line).toContain("…");
	});

	it("context shows ?/window when tokens are unknown", () => {
		const line = plain(buildLine(data({ context: { tokens: null, window: 200_000, percent: null } }), 0, "│"));
		expect(line).toContain("?/200k");
	});

	it("spend variants", () => {
		expect(plain(buildLine(data({ spend: { mode: "api", cost: 0.4231 } }), 0, "│"))).toContain("$0.42");
		expect(plain(buildLine(data({ spend: { mode: "oauth", stale: false } }), 0, "│"))).toContain("sub");
		expect(plain(buildLine(data({ spend: { mode: "oauth", stale: false, cost: 1.5 } }), 0, "│"))).toContain("$1.50");
		// null bucket omitted
		const q = plain(buildLine(data({ spend: { mode: "oauth", quota: { fiveHour: 10 }, stale: true } }), 0, "│"));
		expect(q).toContain("5h 10%");
		expect(q).not.toContain("7d");
	});

	it("cache variants", () => {
		expect(plain(buildLine(data({ cache: { kind: "hidden" }, tps: undefined }), 0, "│"))).not.toContain("CH");
		expect(plain(buildLine(data({ cache: { kind: "none" }, tps: undefined }), 0, "│"))).toContain("CH -- · — tok/s");
	});
});

describe("colors and formatting", () => {
	it("threshold bands", () => {
		expect(contextColor(50)).toBe("dim");
		expect(contextColor(71)).toBe("warning");
		expect(contextColor(91)).toBe("error");
		expect(contextColor(null)).toBe("dim");
		expect(quotaColor(74)).toBe("muted");
		expect(quotaColor(75)).toBe("warning");
		expect(quotaColor(90)).toBe("error");
		expect(cacheColor(29)).toBe("error");
		expect(cacheColor(69)).toBe("warning");
		expect(cacheColor(70)).toBe("success");
	});
	it("rainbow keeps visible text and width", () => {
		const r = rainbow("think:max");
		expect(plain(r)).toBe("think:max");
		expect(visibleWidth(r)).toBe(9);
	});
	it("formatTokens", () => {
		expect(formatTokens(950)).toBe("950");
		expect(formatTokens(84_000)).toBe("84k");
		expect(formatTokens(1500)).toBe("1.5k");
		expect(formatTokens(200_000)).toBe("200k");
		expect(formatTokens(1_000_000)).toBe("1M");
	});
});

describe("ascii icons in the status line", () => {
	it("adds glyphs to dir, git and context (think stays plain text, model has none); none mode adds none", () => {
		const ascii = plain(buildLine(data({ icons: "ascii" }), 0, "│"));
		expect(ascii).toContain("think:high");
		expect(ascii).toContain("◫ 84k/200k");
		expect(ascii).toContain("dir lumen");
		expect(ascii).toContain("⎇ main");
		const none = plain(buildLine(data({ icons: "none" }), 0, "│"));
		expect(none).not.toMatch(/[◫⎇]|dir /u);
	});
	it("still fits a narrow width with icons on", () => {
		for (const w of [30, 50, 80]) expect(visibleWidth(fitLine(data({ icons: "ascii" }), w, "│"))).toBeLessThanOrEqual(w);
	});
});
