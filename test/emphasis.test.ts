import { describe, expect, it } from "vitest";
import { DEFAULTS, resolveConfig } from "../src/config.ts";
import { CONTEXT_WORDS, VOCABULARY, createPalette, decorate, replyGuidance, toneOf, type ThemeLike } from "../src/emphasis.ts";

// A theme whose colors are readable tags, so tests can assert on what was colored.
const theme: ThemeLike = {
	fg: (color: string, text: string) => `<${color}>${text}</>`,
	getFgAnsi: (color: string) => `\x1b[38;fg-${color}m`,
	getBgAnsi: (color: string) => `\x1b[48;bg-${color}m`,
} as unknown as ThemeLike;
const palette = createPalette(theme);
const strip = (text: string) => text.replace(/\x1b\[[0-9;a-zA-Z-]*m/g, "").replace(/\u00a0/g, " ").replace(/<\/?[a-zA-Z]*>/g, "");
const plain = (text: string, p = palette) => strip(decorate(text, p));
const noIcons = createPalette(theme, "mdLink", false);
// Nerd Font glyphs live in the Private Use Area: pi-lumen must never emit one on its own.
const PUA = /[\ue000-\uf8ff]|[\u{f0000}-\u{10ffff}]/u;

describe("pill tone", () => {
	it.each([
		["Failed", "error"], ["Blocked", "error"], ["Needs you", "warning"], ["Decision", "warning"],
		["Done", "success"], ["Observed", "success"], ["Costs money", "danger"], ["Irreversible", "danger"],
		["Implement", "mode"], ["Shared", "owner"], ["Inferred", "neutral"], ["Anything else", "neutral"],
	])("%s is %s", (word, tone) => expect(toneOf(word)).toBe(tone));

	it("case and spacing do not matter; a known word may carry detail", () => {
		expect(toneOf("  needs   YOU ")).toBe("warning");
		expect(toneOf("Passed 12/12")).toBe("success");
		expect(toneOf("Failed: 3 tests")).toBe("error");
	});
	it("a longer word that starts like a known one is not that word", () => expect(toneOf("Donezo")).toBe("neutral"));
});

describe("pills", () => {
	it("are square chips with plain Unicode icons, no caps", () => {
		expect(plain("[[Done]]")).toBe(" ✓ Done ");
		expect(plain("[[Failed: 3 tests]]")).toBe(" ✗ Failed: 3 tests ");
	});
	it("an unknown word has no icon", () => expect(plain("[[Anything else]]")).toBe(" Anything else "));
	it("synonyms display as one word and keep their detail", () => {
		expect(plain("[[Completed]]")).toBe(" ✓ Done ");
		expect(plain("[[Fail: 3 tests]]")).toBe(" ✗ Failed: 3 tests ");
	});
	it("a label's own Nerd Font glyph still wins over the table's", () => expect(plain("[[\uf0e7 Done]]")).toBe(" \uf0e7 Done "));
	it("labels over 32 characters are left alone", () => {
		const long = `[[${"x".repeat(33)}]]`;
		expect(plain(long)).toBe(long);
	});
	it("a two-word pill stays on one line (no-break spaces)", () => expect(decorate("[[Needs you]]", palette)).toContain("Needs\u00a0you"));
	it("a pill in a heading is a chip too, never raw brackets", () => {
		expect(plain("## Cosa mi serve da te [[Needs you]]")).toBe("## Cosa mi serve da te  ▸ Needs you ");
		expect(plain("## Finding [[Done]]")).toBe("## Finding  ✓ Done ");
	});
	it("a pill inside bold restores the bold color afterwards", () => {
		const out = decorate("**a [[Done]] b**", palette);
		expect(out).toContain("\x1b[1m<mdLink>");
	});
	it("a theme without panel colors falls back to reverse video", () => {
		const bare = createPalette({ ...theme, getBgAnsi: () => "\x1b[49m" } as unknown as ThemeLike);
		expect(decorate("[[Done]]", bare)).toContain("\x1b[7m");
	});
});

describe("labels", () => {
	it("a heading takes an icon from its word; an unknown one is untouched", () => {
		expect(plain("## Finding")).toBe("## ◎ Finding");
		expect(plain("## What happened")).toBe("## What happened");
	});
	it("a leading bold label takes an icon, after list markers and tree connectors", () => {
		expect(plain("**Cause:** x")).toBe("**↳ Cause:** x");
		expect(plain("- **Fix:** x")).toBe("- **✚ Fix:** x");
		expect(decorate("  ├── **Risk:** x", palette)).toBe("  <dim>├──</> **<mdLink>! Risk:</>** x");
	});
	it("bold later in a line gets color but no icon", () => expect(decorate("see **Cause** here", palette)).toBe("see **<mdLink>Cause</>** here"));
});

describe("action lead-ins", () => {
	it("take an icon anywhere in a line when they end in a colon", () => {
		expect(plain("[[Unverified]] red pills. **Check:** run it")).toBe(" ? Unverified  red pills. **◇ Check:** run it");
		expect(plain("- **Unblock:** access")).toBe("- **↗ Unblock:** access");
	});
	it("get exactly one icon at the start of a line", () => expect(plain("**Next:** go")).toBe("**▸ Next:** go"));
	it("without a colon they are ordinary bold", () => expect(decorate("please **do** it", palette)).toBe("please **<mdLink>do</>** it"));
});

describe("what is left alone", () => {
	it("fenced code", () => {
		const block = "```\n**Cause:** → [[Done]]\n```";
		expect(decorate(block, palette)).toBe(block);
	});
	it("inline code", () => expect(plain("`[[Done]] → **x**`")).toBe("`[[Done]] → **x**`"));
	it("escaped asterisks", () => expect(plain("\\*\\*not bold\\*\\*")).toBe("\\*\\*not bold\\*\\*"));
	it("an unclosed bold span ends its color at the line end", () => expect(decorate("**open", palette)).toBe("**<mdLink>open</>"));
});

it("arrows, checks and crosses take their colors", () => {
	expect(decorate("a → b ✓ c ✗", palette)).toBe("a <accent>→</> b <success>✓</> c <error>✗</>");
});

describe("icons off", () => {
	it("pills, headings and lead-ins lose their icons", () => {
		expect(plain("[[Done]]", noIcons)).toBe(" Done ");
		expect(plain("## Finding", noIcons)).toBe("## Finding");
		expect(plain("**Check:** x", noIcons)).toBe("**Check:** x");
	});
});

describe("no Nerd Font needed", () => {
	const samples = [
		...Object.values(VOCABULARY).flatMap((w) => [...w.core, ...w.also]),
		...CONTEXT_WORDS,
		"Findings",
	].map((w) => `[[${w}]]`).join(" ");
	const labels = ["Finding", "Cause", "Next", "Risk", "Status", "Result", "Terminal", "Branch"].map((w) => `## ${w}\n- **${w}:** x`).join("\n");
	const leads = ["Check", "Do", "Next", "Unblock", "Left", "Run", "Guard", "Undo", "See"].map((w) => `**${w}:** x`).join("\n");
	it("emits no Private Use Area glyph and no cap characters", () => {
		expect(decorate(`${samples}\n${labels}\n${leads}`, palette)).not.toMatch(PUA);
	});
	it("each icon is a single narrow code point", () => {
		const icons = new Set<string>();
		for (const m of decorate(`${samples}\n${labels}\n${leads}`, palette).matchAll(/\u00a0(\S)\u00a0|\*\*(\S) /g)) icons.add((m[1] ?? m[2]) as string);
		for (const icon of icons) expect([...icon]).toHaveLength(1);
		expect(icons.size).toBeGreaterThan(10);
	});
	it("guidance contains no PUA glyph either", () => {
		expect(replyGuidance("short")).not.toMatch(PUA);
		expect(replyGuidance("full")).not.toMatch(PUA);
	});
});

describe("reply guidance", () => {
	const full = replyGuidance("full");
	const short = replyGuidance("short");
	it("full names every core word, and each one is colored as its tone", () => {
		for (const [tone, words] of Object.entries(VOCABULARY)) {
			for (const word of words.core) {
				expect(full).toContain(`[[${word}]]`);
				expect(toneOf(word)).toBe(tone);
			}
		}
		for (const word of CONTEXT_WORDS) expect(full).toContain(`[[${word}]]`);
	});
	it("short names the red, yellow and green words only, and is much smaller", () => {
		for (const tone of ["error", "warning", "success"] as const) for (const word of VOCABULARY[tone].core) expect(short).toContain(`[[${word}]]`);
		for (const tone of ["danger", "mode", "owner"] as const) for (const word of VOCABULARY[tone].core) expect(short).not.toContain(`[[${word}]]`);
		expect(short.length).toBeLessThan(full.length / 4);
		expect(short.length).toBeLessThan(1400);
	});
	it("short asks for a bold lead-in after every red or yellow pill, and each lead-in gets an icon", () => {
		for (const word of ["Do", "Check", "Next", "Unblock", "Left"]) {
			expect(short).toContain(`**${word}:**`);
			expect(plain(`x **${word}:** y`)).not.toBe(`x **${word}:** y`);
		}
	});
	it("every pill either one mentions is a known word, so no example teaches an uncolored one", () => {
		const known = [...Object.values(VOCABULARY).flatMap((w) => w.core), ...CONTEXT_WORDS, "Word"];
		for (const text of [full, short]) {
			for (const [, label] of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
				expect(known.some((k) => label === k || label?.startsWith(`${k} `) || label?.startsWith(`${k}:`))).toBe(true);
			}
		}
	});
	it("every lead-in full lists gets an icon", () => {
		for (const word of ["Check", "Do", "Next", "Unblock", "Left", "Run", "Guard", "Undo", "See"]) {
			expect(full).toContain(`**${word}:**`);
			expect(plain(`x **${word}:** y`)).not.toBe(`x **${word}:** y`);
		}
	});
	it("addresses any user", () => {
		expect(full).not.toMatch(/\bJohn\b|~\/dev|\bbun\b/);
		expect(short).not.toMatch(/\bJohn\b|~\/dev|\bbun\b/);
	});
});

describe("emphasis config", () => {
	it("is off by default, with short guidance", () => {
		expect(DEFAULTS.emphasis).toEqual({ enabled: false, guidance: "short", icons: true, color: "mdLink" });
	});
	it("merges settings and rejects a bad guidance value or an empty color", () => {
		expect(resolveConfig({ emphasis: { enabled: true, guidance: "full", icons: false } }, null).emphasis).toEqual({ enabled: true, guidance: "full", icons: false, color: "mdLink" });
		const c = resolveConfig({ emphasis: { guidance: "huge", color: " " } }, null).emphasis;
		expect(c.guidance).toBe("short");
		expect(c.color).toBe("mdLink");
		expect(resolveConfig({ emphasis: { guidance: "off" } }, null).emphasis.guidance).toBe("off");
	});
	it("a saved `/lumen emphasis` wins over settings.json; a non-boolean saved value is ignored", () => {
		expect(resolveConfig({ emphasis: { enabled: true } }, { emphasisEnabled: false }).emphasis.enabled).toBe(false);
		expect(resolveConfig(undefined, { emphasisEnabled: true }).emphasis.enabled).toBe(true);
		expect(resolveConfig({ emphasis: { enabled: true } }, { emphasisEnabled: "no" }).emphasis.enabled).toBe(true);
		expect(resolveConfig(undefined, { emphasisEnabled: true }).emphasis.guidance).toBe("short");
	});
});
