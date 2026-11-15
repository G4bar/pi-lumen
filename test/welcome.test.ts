import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { BLUE, CORAL, YELLOW } from "../src/palette.ts";
import { countContextFiles, formatTimeAgo, PI_PIXELS, piLogo, renderWelcome, type WelcomeData, type WelcomeTheme } from "../src/welcome.ts";

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const theme: WelcomeTheme = { fg: (_c, t) => t, bold: (t) => t, getColorMode: () => "truecolor" };
const data = (over: Partial<WelcomeData> = {}): WelcomeData => ({
	modelName: "Claude Opus 4",
	providerName: "anthropic",
	version: "1.5.2",
	recentSessions: [{ name: "lumen", timeAgo: "2h ago" }],
	loaded: { contextFiles: 2, skills: 1, promptTemplates: 0 },
	tips: [{ key: "/", label: "for commands" }],
	...over,
});

describe("pi logo", () => {
	it("is pi's 4x4 pixel logo in coral, blue and yellow", () => {
		expect(PI_PIXELS.flat().filter((p) => p === CORAL)).toHaveLength(4);
		expect(PI_PIXELS.flat().filter((p) => p === BLUE)).toHaveLength(4);
		expect(PI_PIXELS.flat().filter((p) => p === YELLOW)).toHaveLength(2);
	});

	it("scale 1 is pi's own two-line, four-cell logo", () => {
		const [top, bottom] = piLogo("truecolor", 1);
		expect(plain(top as string)).toBe("▀▀█ ");
		expect(plain(bottom as string)).toBe("█▀ █");
		expect(top).toContain("38;2;228;138;122"); // coral
		expect(bottom).toContain("38;2;234;182;93"); // yellow
	});

	it("scale 3 is 12 columns by 6 lines", () => {
		const logo = piLogo("truecolor", 3);
		expect(logo).toHaveLength(6);
		for (const l of logo) expect(visibleWidth(l)).toBe(12);
	});
});

describe("welcome box", () => {
	it.each([10, 30, 43, 44, 60, 76, 100, 200])("never overflows at %i columns", (w) => {
		for (const d of [data(), data({ recentSessions: undefined }), data({ recentSessions: [], loaded: { contextFiles: 0, skills: 0, promptTemplates: 0 } }), data({ modelName: "x".repeat(80) })]) {
			for (const l of renderWelcome(d, theme, w)) expect(visibleWidth(l)).toBeLessThanOrEqual(w);
		}
	});

	it("shows model, tips, loaded counts and recent sessions", () => {
		const text = renderWelcome(data(), theme, 100).map(plain).join("\n");
		expect(text).toContain("Welcome back!");
		expect(text).toContain("Claude Opus 4");
		expect(text).toContain("v1.5.2");
		expect(text).toContain("/ for commands");
		expect(text).toContain("2 context files");
		expect(text).toContain("1 skill");
		expect(text).not.toContain("prompt template");
		expect(text).toContain("lumen (2h ago)");
	});

	it("is a closed box: all rows have the same width", () => {
		const lines = renderWelcome(data(), theme, 100);
		expect(new Set(lines.map(visibleWidth)).size).toBe(1);
		expect(plain(lines[0] as string)).toMatch(/^╭─+ Pi v1\.5\.2 ─+╮$/);
		expect(plain(lines.at(-1) as string)).toMatch(/^╰─+┴─+╯$/);
	});

	it("narrow terminals get the small logo only", () => {
		const lines = renderWelcome(data(), theme, 30);
		expect(lines).toHaveLength(2);
		expect(plain(lines[0] as string)).toContain("Pi");
	});
});

describe("welcome colors", () => {
	it("everything but the logo comes from theme tokens, nothing is hard-coded", () => {
		const tagged: WelcomeTheme = { fg: (c, t) => `<${c}>${t}</>`, bold: (t) => t, getColorMode: () => "truecolor" };
		const text = renderWelcome(data(), tagged, 100).map(plain).join("\n"); // plain() drops the logo's escapes only
		expect(text).toContain("<accent>Claude Opus 4</>");
		expect(text).toContain("<mdHeading>Tips</>");
		expect(text).toContain("<border>Loaded</>");
		expect(text).toContain("<accent>Recent sessions</>");
	});
});

describe("discovery", () => {
	it("counts one context file per directory, global first", () => {
		const have = new Set(["/g/AGENTS.md", "/a/b/CLAUDE.md", "/a/AGENTS.md", "/a/AGENTS.override.md"]);
		expect(countContextFiles("/a/b/c", "/g", (p) => have.has(p))).toBe(3);
		expect(countContextFiles("/x", "/g", () => false)).toBe(0);
	});

	it("formats relative times", () => {
		expect(formatTimeAgo(10_000)).toBe("just now");
		expect(formatTimeAgo(5 * 60_000)).toBe("5m ago");
		expect(formatTimeAgo(3 * 3_600_000)).toBe("3h ago");
		expect(formatTimeAgo(2 * 86_400_000)).toBe("2d ago");
	});
});
