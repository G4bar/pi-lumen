import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { loadBootSettings } from "../src/config.ts";
import { RowThinking } from "../src/thinking-label.ts";
import { Block, changeBody, framed, framedLines, prefixed } from "../src/tools/format.ts";
import { outputLines } from "../src/tools/bash.ts";
import { builtinToolOptions } from "../src/tools/options.ts";
import { bgTints, changedSpans, diffRows, parseDiff, type Tints, tintLine, writeRows } from "../src/tools/changes.ts";
import { paintLines, shikiPainter, shikiThemeName } from "../src/tools/highlight.ts";
import { codeBody, splitRead } from "../src/tools/read.ts";
import { fgParams, isLowContrast, languageFor, tokensToAnsi } from "../src/tools/shiki.ts";

describe("splitRead", () => {
	it("does not count the trailing newline", () => {
		expect(splitRead("a\nb\n").lines).toEqual(["a", "b"]);
		expect(splitRead("").lines).toEqual([]);
	});
	it("separates pi's continuation notice from the content", () => {
		const r = splitRead("l1\nl2\n\n[98 more lines in file. Use offset=3 to continue.]");
		expect(r.lines).toEqual(["l1", "l2"]);
		expect(r.notice).toBe("[98 more lines in file. Use offset=3 to continue.]");
		expect(splitRead("x\n\n[Showing lines 1-2000 of 3000. Use offset=2001 to continue.]").lines).toEqual(["x"]);
	});
});

describe("outputLines", () => {
	it("ignores the (no output) placeholder, the failure status and the truncation notice", () => {
		expect(outputLines("(no output)")).toEqual([]);
		expect(outputLines("a\nb\n\nCommand exited with code 2")).toEqual(["a", "b"]);
		expect(outputLines("a\n\n[Showing lines 1-2000 of 5000. Full output: /tmp/x]")).toEqual(["a"]);
	});
});

describe("RowThinking", () => {
	it("keeps one label per message and resumes a message's total", () => {
		let t = 0;
		const r = new RowThinking(() => t);
		expect(r.labelFor(1)).toBe("Thought");
		r.start(1);
		t = 3000;
		expect(r.labelFor(1)).toBe("Thinking… 3s");
		r.stop(1);
		r.start(2);
		t = 5000;
		expect(r.labelFor(1)).toBe("Thought for 3s");
		expect(r.labelFor(2)).toBe("Thinking… 2s");
		expect(r.globalLabel()).toBe("Thinking… 2s");
		r.stop(2);
		expect(r.globalLabel()).toBe("Thought");
		r.start(1); // second thinking block of message 1 resumes the count
		t = 6000;
		expect(r.labelFor(1)).toBe("Thinking… 4s");
	});

	it("wraps the host setter per row and restores it", () => {
		class Row {
			label = "";
			lastMessage: { timestamp?: number } | undefined = { timestamp: 7 };
			setHiddenThinkingLabel(l: string): void {
				this.label = l;
			}
		}
		const orig = Row.prototype.setHiddenThinkingLabel;
		const r = new RowThinking(() => 0);
		expect(r.install(Row)).toBe(true);
		const row = new Row();
		row.setHiddenThinkingLabel("global");
		expect(row.label).toBe("Thought");
		row.lastMessage = undefined; // unknown row: the incoming label passes through
		row.setHiddenThinkingLabel("global");
		expect(row.label).toBe("global");
		r.dispose();
		expect(Row.prototype.setHiddenThinkingLabel).toBe(orig);
		expect(r.install({})).toBe(false); // reshaped host: no-op
	});
});

describe("loadBootSettings", () => {
	it("reads the global `lumen` key only (project settings are not trusted at load time); tolerates missing files", () => {
		const root = mkdtempSync(join(tmpdir(), "lumen-cfg-"));
		const agent = join(root, "agent");
		mkdirSync(agent);
		writeFileSync(join(agent, "settings.json"), JSON.stringify({ lumen: { tools: { enabled: false, previewLines: 5 }, placement: "above" } }));
		expect(loadBootSettings(agent)).toEqual({ tools: { enabled: false, previewLines: 5 }, placement: "above" });
		expect(loadBootSettings(join(root, "none"))).toEqual({});
	});
});

describe("builtinToolOptions", () => {
	it("forwards shellCommandPrefix, shellPath (tilde expanded) and images.autoResize like pi does", () => {
		const o = builtinToolOptions({ getSettings: () => ({ shellCommandPrefix: "set -e", shellPath: "~/bin/zsh", images: { autoResize: false } }) } as never);
		expect(o.bash).toEqual({ commandPrefix: "set -e", shellPath: join(homedir(), "bin/zsh") });
		expect(o.read).toEqual({ autoResizeImages: false });
	});
	it("falls back to SDK defaults when settings are empty or unavailable", () => {
		expect(builtinToolOptions({ getSettings: () => ({}) } as never)).toEqual({ bash: { commandPrefix: undefined, shellPath: undefined }, read: {} });
		expect(builtinToolOptions({ getSettings: () => { throw new Error("loading"); } } as never)).toEqual({ bash: {}, read: {} });
	});
});

describe("shiki helpers", () => {
	it("turns tokens into foreground-only ANSI and lifts near-black colors", () => {
		const [line] = tokensToAnsi([[{ content: "const", color: "#ff7b72", fontStyle: 2 }, { content: " x", color: "#0a0a0a" }, { content: ";" }]]);
		expect(line).toBe("\x1b[38;2;255;123;114;1mconst\x1b[39;22m\x1b[38;2;139;148;158m x\x1b[39m;");
		expect(line).not.toContain("\x1b[0m"); // a full reset would also wipe the box/diff background behind the row
		expect(isLowContrast(10, 10, 10)).toBe(true);
		expect(fgParams("#79c0ff")).toBe("38;2;121;192;255");
		expect(fgParams("not-a-color")).toBeUndefined();
	});
	it("light themes keep near-black foregrounds (the dark-theme contrast guard would grey them)", () => {
		expect(fgParams("#0a0a0a", true)).toBe("38;2;10;10;10");
		expect(tokensToAnsi([[{ content: "x", color: "#24292e" }]], true)[0]).toBe("\x1b[38;2;36;41;46mx\x1b[39m");
	});
	it("`tools.theme: auto` follows the brightness of the pi theme's tool background; explicit names win", () => {
		const bg = (ansi: string) => ({ getBgAnsi: () => ansi }) as never;
		expect(shikiThemeName("auto", bg("\x1b[48;2;222;233;225m"))).toBe("github-light");
		expect(shikiThemeName("auto", bg("\x1b[48;2;37;65;49m"))).toBe("github-dark");
		expect(shikiThemeName("auto", bg("\x1b[49m"))).toBe("github-dark"); // no box background: dark default
		expect(shikiThemeName("auto", { getBgAnsi: () => { throw new Error("x"); } } as never)).toBe("github-dark");
		expect(shikiThemeName("nord", bg("\x1b[48;2;222;233;225m"))).toBe("nord");
	});
	it("maps paths to Shiki languages with a fallback, ignoring unknown ones", async () => {
		expect(await languageFor("src/a.ts", undefined)).toBe("ts");
		expect(await languageFor("Dockerfile", undefined)).toBe("dockerfile");
		expect(await languageFor("notes.zzz", undefined)).toBeUndefined();
		expect(await languageFor("x.unknownext", "python")).toBe("python");
	});
});

describe("codeBody", () => {
	const theme = { fg: (_c: string, s: string) => s, bold: (s: string) => s } as never;
	it("frames the body with full-width rules, a right-aligned gutter and a remaining-lines marker", () => {
		const out = codeBody(theme, ["a", "b", "c"], "x.txt", 9, 2, "[hint]", undefined, 6);
		expect(out).toBe("\n  ──────\n   9 │ a\n  10 │ b\n  … 1 more lines\n  [hint]\n  ──────");
	});
});

describe("framedLines", () => {
	const theme = { fg: (_c: string, s: string) => s } as never;
	it("frames, caps and marks the remainder; empty input renders nothing", () => {
		expect(framedLines(theme, ["a", "b", "c"], 2, undefined, 4)).toBe("\n  ────\n  a\n  b\n  … 1 more lines\n  ────");
		expect(framedLines(theme, [], 5)).toBe("");
	});
});

describe("Block (narrow terminals)", () => {
	const theme = { fg: (_c: string, s: string) => s } as never;
	it("cuts every row to the width instead of wrapping into unindented fragments", () => {
		const rows = new Block("● Bash (a very long command line that does not fit)\n  └ exit 0 · 3 lines · 0.01s · ctrl+o to expand").render(20);
		expect(rows).toHaveLength(2);
		for (const r of rows) expect(visibleWidth(r)).toBeLessThanOrEqual(20);
		expect(rows[0]).toContain("…");
	});
	it("wraps only when asked (expanded call header)", () => {
		expect(new Block("word ".repeat(12).trim(), true).render(20).length).toBeGreaterThan(1);
	});
	it("draws rules at the real width, never wider", () => {
		const rows = new Block(framed(theme, ["x"])).render(30);
		const rule = rows.find((r) => r.includes("─")) ?? "";
		expect(visibleWidth(rule)).toBe(30);
		expect(new Block(framed(theme, ["x"])).render(8).every((r) => visibleWidth(r) <= 8)).toBe(true);
		expect(new Block("  \n").render(10)).toEqual([]);
	});
});

describe("changeBody", () => {
	const theme = { fg: (_c: string, s: string) => s } as never;
	it("shows changes by default, caps them, and only offers expansion when something is hidden", () => {
		const rows = ["a", "b", "c", "d"];
		const small = changeBody(theme, rows, false, 10, 20);
		expect(small.toggle).toBe(false);
		expect(small.body).toContain("  d");
		const capped = changeBody(theme, rows, false, 2, 3);
		expect(capped.toggle).toBe(true);
		expect(capped.body).toContain("… 2 more lines");
		expect(changeBody(theme, rows, true, 2, 3).body).toContain("… 1 more lines");
		expect(changeBody(theme, [], false, 5, 5)).toEqual({ body: "", toggle: false });
	});
});

describe("prefixed / wrapped call rows", () => {
	it("wrapped pieces repeat the gutter instead of falling under it", () => {
		const rows = prefixed("  │ ", "word ".repeat(10).trim(), 20, true);
		expect(rows.length).toBeGreaterThan(1);
		for (const r of rows) {
			expect(r.startsWith("  │ ")).toBe(true);
			expect(visibleWidth(r)).toBeLessThanOrEqual(20);
		}
	});
	it("collapsed: one row, cut with an ellipsis", () => {
		const rows = prefixed("  │ ", "x".repeat(60), 20, false);
		expect(rows).toHaveLength(1);
		expect(visibleWidth(rows[0] ?? "")).toBeLessThanOrEqual(20);
		expect(rows[0]).toContain("…");
	});
	it("Block accepts width-aware content and indents its own wrapped continuations", () => {
		expect(new Block((w) => `w=${w}`).render(33)).toEqual(["w=33"]);
		const rows = new Block("word ".repeat(12).trim(), true).render(20);
		expect(rows.slice(1).every((r) => r.startsWith("  "))).toBe(true);
	});
});

describe("parseDiff (pi's display diff)", () => {
	it("reads signs, padded line numbers, text that starts with digits, and skipped-context markers", () => {
		const diff = [" 8 const a = 1;", "-9 42 is the answer", "+9 43 is the answer", "+10 \tindented", "   ...", "11 tail"].join("\n");
		expect(parseDiff(diff)).toEqual([
			{ kind: "ctx", no: 8, text: "const a = 1;" },
			{ kind: "del", no: 9, text: "42 is the answer" },
			{ kind: "add", no: 9, text: "43 is the answer" },
			{ kind: "add", no: 10, text: "\tindented" },
			{ kind: "gap", no: 0, text: "" },
		]);
	});
});

describe("diffRows / writeRows", () => {
	const theme = { fg: (_c: string, s: string) => s, bold: (s: string) => s } as never;
	const diff = [" 9 keep", "-10 old", "+10 new", " 11 end", "   ...", " 20 far"].join("\n");
	it("edit: number + sign slot share one column, numbers right-aligned to the widest, gaps marked", () => {
		const { rows, total } = diffRows(theme, diff, "x.txt", 99);
		expect(total).toBe(6);
		expect(rows).toEqual([" 9 │ keep", "10 - old", "10 + new", "11 │ end", "   ⋯", "20 │ far"]);
	});
	it("edit: paints each side with the highlighter and only the visible rows", () => {
		const seen: string[] = [];
		const shiki = (code: string) => {
			seen.push(code);
			return code.split("\n").map((l) => `<${l}>`);
		};
		const { rows, total } = diffRows(theme, diff, "x.txt", 3, shiki);
		expect(total).toBe(6);
		expect(rows).toEqual([" 9 │ <keep>", "10 - <old>", "10 + <new>"]);
		expect(seen).toEqual(["keep\nold", "keep\nnew"]);
	});
	it("write: right-aligned numbers with a + slot, highlighted code, capped to max", () => {
		const lines = Array.from({ length: 12 }, (_, i) => `l${i + 1}`);
		const rows = writeRows(theme, lines, "x.txt", 10, (c) => c.split("\n").map((l) => `<${l}>`));
		expect(rows).toHaveLength(10);
		expect(rows[0]).toBe(" 1 + <l1>");
		expect(rows[9]).toBe("10 + <l10>");
	});
});

describe("changedSpans (words that changed inside a -/+ pair)", () => {
	it("marks every changed word, whole, with the unchanged words between them left alone", () => {
		const a = "return `hi ${n}` + 42;";
		const b = "return `hello ${n}` + 43;";
		const sp = changedSpans(a, b);
		expect(sp?.del.map(([f, t]) => a.slice(f, t))).toEqual(["hi", "42"]);
		expect(sp?.add.map(([f, t]) => b.slice(f, t))).toEqual(["hello", "43"]);
	});
	it("a number or identifier that differs is marked whole", () => {
		expect(changedSpans("x = 42;", "x = 43;")).toEqual({ del: [[4, 6]], add: [[4, 6]] });
		expect(changedSpans("const abc = 1;", "const abd = 1;")).toEqual({ del: [[6, 9]], add: [[6, 9]] });
	});
	it("pure insertion marks only the added side; nearly-total rewrites and huge lines mark nothing", () => {
		const sp = changedSpans("f(a)", "f(a, b)");
		expect(sp?.del).toEqual([]);
		expect("f(a, b)".slice(...(sp?.add[0] ?? [0, 0]))).toBe(", b");
		expect(changedSpans("alpha beta gamma", "zzz yyy xxx")).toBeUndefined();
		expect(changedSpans("a ".repeat(400), "b ".repeat(400))).toBeUndefined();
	});
});

describe("tintLine", () => {
	const tint = { base: "<B>", strong: "<S>" };
	it("sets the background once, strong only on the span, and restores it after the painter's resets", () => {
		expect(tintLine("abcd", tint, [[1, 3]])).toBe("<B>a<S>bc<B>d<B>");
		expect(tintLine("abcd", tint, [[0, 1], [3, 4]])).toBe("<S>a<B>bc<S>d<B>");
		// pi/Shiki painters end tokens with a full reset: the background must be drawn again afterwards
		expect(tintLine("\x1b[31ma\x1b[0mb", tint)).toBe("\x1b[31m<B>a\x1b[0m<B>b<B>");
		// 24-bit operands that look like resets (38;2;0;0;0) are not resets
		expect(tintLine("\x1b[38;2;0;0;0ma", tint)).toBe("\x1b[38;2;0;0;0m<B>a<B>");
		expect(tintLine("\x1b[39ma\x1b[49mb", tint)).toBe("\x1b[39m<B>a\x1b[49m<B>b<B>");
	});
	it("an empty line still carries the background", () => {
		expect(tintLine("", tint)).toBe("<B>");
	});
});

describe("bgTints / diffRows backgrounds", () => {
	const mk = (box: string, add: string, del: string) =>
		({
			fg: (_c: string, s: string) => s,
			bold: (s: string) => s,
			getBgAnsi: () => box,
			getFgAnsi: (k: string) => (k === "toolDiffAdded" ? add : del),
		}) as never;
	const dark = mk("\x1b[48;2;40;40;40m", "\x1b[38;2;100;200;100m", "\x1b[38;2;200;100;100m");
	it("mixes the added/removed foreground into the box's grey: lightly for the row, more for changed words", () => {
		const t = bgTints(dark) as Tints;
		expect(t.add.base).toBe("\x1b[48;2;55;80;55m"); // 40 + (100-40)*0.25 = 55, 40 + (200-40)*0.25 = 80
		expect(t.add.strong).toBe("\x1b[48;2;70;120;70m"); // 40 + 60*0.5, 40 + 160*0.5
		expect(t.del.base).toBe("\x1b[48;2;80;55;55m");
	});
	it("a colored box does not muddy the tints: a green box still gives a red `removed` row", () => {
		const t = bgTints(mk("\x1b[48;2;37;65;49m", "\x1b[38;2;104;183;141m", "\x1b[38;2;232;138;117m")) as Tints;
		const [r, g] = /48;2;(\d+);(\d+)/.exec(t.del.base)?.slice(1).map(Number) as [number, number];
		expect(r).toBeGreaterThan(g + 15);
	});
	it("light boxes tint the same way (darker green on a pale box), so rows still stand out", () => {
		const t = bgTints(mk("\x1b[48;2;222;233;225m", "\x1b[38;2;51;126;88m", "\x1b[38;2;180;60;60m")) as Tints;
		expect(t.add.base).toBe("\x1b[48;2;185;204;195m");
	});
	it("no background without truecolor, without a box background, or when the lookup throws", () => {
		expect(bgTints(mk("\x1b[48;5;22m", "\x1b[38;5;2m", "\x1b[38;5;1m"))).toBeUndefined();
		expect(bgTints(mk("\x1b[49m", "\x1b[38;2;1;2;3m", "\x1b[38;2;1;2;3m"))).toBeUndefined();
		expect(bgTints({ fg: (_c: string, s: string) => s } as never)).toBeUndefined();
		expect(bgTints({ getBgAnsi: () => { throw new Error("x"); } } as never)).toBeUndefined();
	});
	it("changed rows get the row background (filled to the edge by Block), the changed words the strong one; context stays plain", () => {
		const { rows } = diffRows(dark, [" 1 keep", "-2 x = 42;", "+2 x = 43;"].join("\n"), "x.txt", 9);
		expect(rows[0]).toBe("1 │ keep");
		const del = new Block(`  ${rows[1]}`).render(20)[0] ?? "";
		expect(del).toContain("\x1b[48;2;80;55;55m"); // row
		expect(del).toContain("\x1b[48;2;120;70;70m"); // `42`
		expect(visibleWidth(del)).toBe(20);
		expect(del.replace(/\x1b\[[0-9;]*m/g, "")).toBe("  2 - x = 42;".padEnd(20));
		expect(rows[2]).toContain("\x1b[48;2;55;80;55m");
	});
	it("a theme without bgs leaves rows exactly as before", () => {
		const theme = { fg: (_c: string, s: string) => s, bold: (s: string) => s } as never;
		expect(diffRows(theme, ["-1 a", "+1 b"].join("\n"), "x.txt", 9).rows).toEqual(["1 - a", "1 + b"]);
	});
});

describe("paintLines / shikiPainter", () => {
	const theme = { fg: (c: string, s: string) => `[${c}]${s}`, bold: (s: string) => s } as never;
	it("uses the Shiki result when the line count matches, otherwise pi's painter", () => {
		expect(paintLines(theme, ["a", "b"], "x.zzz", () => ["A", "B"])).toEqual(["A", "B"]);
		expect(paintLines(theme, ["a", "b"], "x.zzz", () => ["only-one"])).toEqual(["[toolOutput]a", "[toolOutput]b"]);
		expect(paintLines(theme, ["a"], "x.zzz", () => undefined)).toEqual(["[toolOutput]a"]);
	});
	it("loads Shiki once per row, redraws when ready and then serves cached lines (never blocks)", async () => {
		let redraws = 0;
		const ctx = { state: {}, invalidate: () => void redraws++ };
		const paint = shikiPainter(ctx, "sample-unit.ts", "github-dark", true);
		const code = "const answer = 42;";
		expect(paint(code)).toBeUndefined(); // first frame: nothing yet
		for (let i = 0; i < 100 && redraws === 0; i++) await new Promise((r) => setTimeout(r, 50));
		expect(redraws).toBeGreaterThan(0);
		const [line] = paint(code) ?? [];
		expect(line).toMatch(/\x1b\[38;2;\d+;\d+;\d+m/); // 24-bit foreground
		expect(line?.replace(/\x1b\[[0-9;]*m/g, "")).toBe(code);
	});
	it("a second code block asked for while the grammar is still loading is highlighted too (edit: old + new side)", async () => {
		let redraws = 0;
		const paint = shikiPainter({ state: {}, invalidate: () => void redraws++ }, "sample-two.ts", "github-dark", true);
		const a = "const a = 1;";
		const b = "let b = 'x';";
		expect(paint(a)).toBeUndefined();
		expect(paint(b)).toBeUndefined(); // same frame, plan still pending
		const both = () => paint(a) !== undefined && paint(b) !== undefined;
		for (let i = 0; i < 100 && !both(); i++) await new Promise((r) => setTimeout(r, 50));
		expect(both()).toBe(true);
	});
	it("enabled=false and unknown languages never highlight", async () => {
		expect(shikiPainter({ state: {}, invalidate: () => {} }, "a.ts", "github-dark", false)("x")).toBeUndefined();
		const ctx = { state: {}, invalidate: () => {} };
		const paint = shikiPainter(ctx, "notes.zzz", "github-dark", true);
		expect(paint("x")).toBeUndefined();
		await new Promise((r) => setTimeout(r, 300));
		expect(paint("x")).toBeUndefined();
	});
});
