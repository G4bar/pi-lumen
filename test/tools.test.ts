import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { loadBootSettings } from "../src/config.ts";
import { RowThinking } from "../src/thinking-label.ts";
import { Block, changeBody, framed, framedLines } from "../src/tools/format.ts";
import { outputLines } from "../src/tools/bash.ts";
import { builtinToolOptions } from "../src/tools/options.ts";
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
		expect(line).toBe("\x1b[38;2;255;123;114;1mconst\x1b[0m\x1b[38;2;139;148;158m x\x1b[0m;");
		expect(isLowContrast(10, 10, 10)).toBe(true);
		expect(fgParams("#79c0ff")).toBe("38;2;121;192;255");
		expect(fgParams("not-a-color")).toBeUndefined();
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
