/** edit / write rows in the real pi TUI: syntax highlighting (Shiki 24-bit colors), gutter and line numbers. */
import { describe, expect, it } from "vitest";
import { ansiLine, hasPi, hasTmux, useSession } from "./harness.ts";
import type { Session } from "./harness.ts";
import type { Step } from "./mock-server.ts";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const TRUECOLOR = /38;2;\d+;\d+;\d+/g;
const fgColors = (line: string) => new Set(line.match(TRUECOLOR));
const BG = /48;2;(\d+;\d+;\d+)/g;
const bgColors = (line: string) => [...line.matchAll(BG)].map((m) => m[1] ?? "");
/** pi's own `toolSuccessBg` behind a successful tool row, per bundled theme (tmux only reports background changes). */
const BOX = { dark: "37;65;49", light: "222;233;225" };
/** Backgrounds on a row besides the tool box's: the diff tints. */
const tints = (line: string, box = BOX.dark) => [...new Set(bgColors(line))].filter((c) => c !== box);

// 12 lines → two-digit line numbers, so right-alignment is observable.
const src = [
	'import { a } from "./a";',
	"",
	"// greeting helper",
	"export function greet(name: string): string {",
	"\tconst n = 42;",
	"\treturn `hi ${name}` + n;",
	"}",
	"",
	"export const answer = 41;",
	"export const flag = true;",
	"export class Box {}",
	"export default greet;",
].join("\n") + "\n";

const call = (name: string, args: Record<string, unknown>): Step[] => [{ toolCalls: [{ name, args }] }, { text: "fine" }];
const responder = (steps: Step[]) => (i: number) => steps[i] ?? { text: "fine" };

async function run(h: ReturnType<typeof useSession>, steps: Step[], files: Record<string, string>, settings?: Record<string, unknown>) {
	const s = await h.start({ responder: responder(steps), files, settings, rows: 60 });
	s.send("go");
	await s.waitFor("fine", 30_000);
	await s.settle();
	return s;
}

/** Wait (Shiki loads lazily) until the row containing `text` carries 24-bit colors. */
async function waitHighlighted(s: Session, text: string): Promise<string> {
	for (let i = 0; i < 60; i++) {
		const l = ansiLine(s, text);
		if (fgColors(l).size > 0) return l;
		await new Promise((r) => setTimeout(r, 250));
	}
	return ansiLine(s, text);
}

/** Column of the sign/separator slot (`│`, `+`, `-`) of every gutter row of the visible body. */
function gutterCols(screen: string): number[] {
	return screen
		.split("\n")
		.map((l) => /^(\s+\d+ )([│+\-⋯])/.exec(l))
		.filter((m): m is RegExpExecArray => m !== null)
		.map((m) => (m[1] ?? "").length);
}

describe.skipIf(!hasTmux || !hasPi)("write: highlighting and gutter", () => {
	const h = useSession();

	it("code is syntax highlighted: several distinct 24-bit colors, text intact", async () => {
		const s = await run(h, call("write", { path: "w.ts", content: src }), {});
		const line = await waitHighlighted(s, "export function greet");
		expect(fgColors(line).size).toBeGreaterThanOrEqual(3); // keyword, function name, type…
		expect(strip(line)).toMatch(/ 4 \+ export function greet\(name: string\): string \{/);
	});

	it("line numbers are right-aligned and the `+` slot lines up (1-digit and 2-digit numbers)", async () => {
		const s = await run(h, call("write", { path: "w.ts", content: src }), {});
		await waitHighlighted(s, "export function greet");
		const screen = s.screen();
		expect(screen).toMatch(/^\s+ 9 \+ export const answer = 41;$/m);
		expect(screen).toMatch(/^\s+10 \+ export const flag = true;$/m);
		const cols = gutterCols(screen);
		expect(cols.length).toBe(12);
		expect(new Set(cols).size).toBe(1);
	});

	it("the gutter is the same dim/green chrome whether or not Shiki is loaded (no color on a plain .txt)", async () => {
		const s = await run(h, call("write", { path: "n.txt", content: "alpha\nbeta\n" }), {});
		await new Promise((r) => setTimeout(r, 1500));
		const l = ansiLine(s, "alpha");
		expect(fgColors(l).size).toBe(0);
		expect(strip(l)).toMatch(/1 \+ alpha/);
	});

	it("tools.shiki=false: pi's highlighter only (no 24-bit colors)", async () => {
		const s = await run(h, call("write", { path: "w.ts", content: src }), {}, { lumen: { quota: { enabled: false }, tools: { shiki: false } } });
		await new Promise((r) => setTimeout(r, 2000));
		expect(ansiLine(s, "export function greet")).not.toMatch(TRUECOLOR);
	});
});

describe.skipIf(!hasTmux || !hasPi)("edit: highlighting and gutter", () => {
	const h = useSession();
	const edit = call("edit", { path: "code.ts", edits: [{ oldText: "\treturn `hi ${name}` + n;", newText: "\treturn `hello ${name}` + n * 2;" }] });

	it("removed and added rows are both syntax highlighted, with red/green number+sign", async () => {
		const s = await run(h, edit, { "code.ts": src });
		const added = await waitHighlighted(s, "hello");
		const removed = await waitHighlighted(s, "`hi ");
		expect(fgColors(added).size).toBeGreaterThanOrEqual(3);
		expect(fgColors(removed).size).toBeGreaterThanOrEqual(3);
		expect(strip(removed)).toMatch(/6 -\s+return `hi \$\{name\}` \+ n;/);
		expect(strip(added)).toMatch(/6 \+\s+return `hello \$\{name\}` \+ n \* 2;/);
		expect(removed).toMatch(/\x1b\[38;5;1m\s*6 -/); // theme "error" red on number + sign
		expect(added).toMatch(/\x1b\[38;5;2m\s*6 \+/); // theme "success" green
	});

	it("context rows keep the `│` gutter with real (old) line numbers; every slot is in the same column", async () => {
		const s = await run(h, edit, { "code.ts": src });
		await waitHighlighted(s, "hello");
		const screen = s.screen();
		expect(screen).toMatch(/^\s+4 │ export function greet/m);
		expect(screen).toMatch(/^\s+5 │\s+const n = 42;/m);
		expect(screen).toMatch(/^\s+7 │ \}/m);
		const cols = gutterCols(screen);
		expect(cols.length).toBeGreaterThanOrEqual(7);
		expect(new Set(cols).size).toBe(1);
	});

	it("2-digit numbers: single-digit ones are right-aligned to the same width", async () => {
		const s = await run(h, call("edit", { path: "code.ts", edits: [{ oldText: "export const flag = true;", newText: "export const flag = false;" }] }), { "code.ts": src });
		await waitHighlighted(s, "false");
		const screen = s.screen();
		expect(screen).toMatch(/^\s+10 - export const flag = true;$/m);
		expect(screen).toMatch(/^\s+10 \+ export const flag = false;$/m);
		expect(screen).toMatch(/^\s+ 9 │ export const answer = 41;$/m);
		expect(new Set(gutterCols(screen)).size).toBe(1);
	});

	it("tools.shiki=false: no 24-bit colors on the diff", async () => {
		const s = await run(h, edit, { "code.ts": src }, { lumen: { quota: { enabled: false }, tools: { shiki: false } } });
		await new Promise((r) => setTimeout(r, 2000));
		expect(ansiLine(s, "hello")).not.toMatch(TRUECOLOR);
	});

	it("narrow terminal: rows are cut, never wrapped, nothing exceeds the width", async () => {
		const s = await h.start({ responder: responder(edit), files: { "code.ts": src }, cols: 40, rows: 60 });
		s.send("go");
		await s.waitFor("fine", 30_000);
		await s.settle();
		for (const r of s.screen().split("\n")) expect(r.length).toBeLessThanOrEqual(40);
	});
});

const withTheme = (theme: string, tools: Record<string, unknown> = {}) => ({ theme, lumen: { quota: { enabled: false }, tools } });

describe.skipIf(!hasTmux || !hasPi)("edit: row backgrounds and changed words", () => {
	const h = useSession();
	const edit = call("edit", { path: "code.ts", edits: [{ oldText: "\treturn `hi ${name}` + n;", newText: "\treturn `hello ${name}` + n * 2;" }] });
	const dark = withTheme("dark");

	it("removed/added rows get a tint of their own color on top of the box background; context rows keep the box's", async () => {
		const s = await run(h, edit, { "code.ts": src }, dark);
		const added = await waitHighlighted(s, "hello");
		const removed = ansiLine(s, "`hi ");
		expect(tints(ansiLine(s, "const n = 42;"))).toEqual([]); // context: nothing but the box
		const [a] = tints(added).map((c) => c.split(";").map(Number));
		const [r] = tints(removed).map((c) => c.split(";").map(Number));
		expect(a).toBeDefined();
		expect(r).toBeDefined();
		expect((a?.[1] ?? 0) - (a?.[0] ?? 0)).toBeGreaterThan(0); // greener than red
		expect((r?.[0] ?? 0) - (r?.[1] ?? 0)).toBeGreaterThan(0); // redder than green
	});

	it("the words that changed get a stronger background than the row; `return` keeps the row's", async () => {
		const s = await run(h, edit, { "code.ts": src }, dark);
		const added = await waitHighlighted(s, "hello");
		const [base, strong] = tints(added);
		expect(base).toBeDefined();
		expect(strong).toBeDefined();
		const at = added.indexOf(`\x1b[48;2;${strong}m`);
		expect(added.indexOf("return")).toBeLessThan(at); // `return` comes first, on the row color
		expect(strip(added.slice(at))).toMatch(/^hello/);
		expect(added.split(`48;2;${strong}`).length - 1).toBeGreaterThanOrEqual(2); // `hello` and `* 2`
	});

	it("the background runs to the right edge of the terminal", async () => {
		const s = await run(h, edit, { "code.ts": src }, dark);
		const added = await waitHighlighted(s, "hello");
		const [base] = tints(added);
		expect(strip(added).length).toBeGreaterThanOrEqual(118); // pi's box leaves a margin on each side
		expect(strip(added)).toMatch(/;\s{20,}$/); // padding after the last character…
		expect(bgColors(added).at(-1)).toBe(base); // …under the row background, not the strong one
		expect(added.trimEnd().endsWith("\x1b[49m")).toBe(true);
	});

	it("light theme: the tint is a darker green/red on the pale box, the text is still readable", async () => {
		const s = await run(h, edit, { "code.ts": src }, withTheme("light"));
		const added = await waitHighlighted(s, "hello");
		const [r, g, b] = (tints(added, BOX.light)[0] ?? "0;0;0").split(";").map(Number) as [number, number, number];
		expect(g).toBeGreaterThan(r); // green tint
		expect(Math.min(r, g, b)).toBeGreaterThan(120); // still a light background
	});

	it("narrow terminal: a long changed row is cut with … and still fills to the edge (no wrap)", async () => {
		const long = `export const text = "alpha ${"word ".repeat(30)}";\n`;
		const s = await h.start({ responder: responder(call("edit", { path: "l.ts", edits: [{ oldText: "alpha", newText: "ALPHA" }] })), files: { "l.ts": long }, cols: 40, rows: 60, settings: dark });
		s.send("go");
		await s.waitFor("fine", 30_000);
		await s.settle();
		const lines = s.screenAnsi().split("\n").filter((l) => /\d [+-] /.test(strip(l)) && l.includes("48;2"));
		expect(lines.length).toBe(2);
		for (const l of lines) {
			expect(strip(l).length).toBeLessThanOrEqual(40);
			expect(strip(l)).toContain("…");
		}
	});

	it("write has no row background (it is a new file, not a change)", async () => {
		const s = await run(h, call("write", { path: "w.ts", content: src }), {}, dark);
		const l = await waitHighlighted(s, "export function greet");
		expect(tints(l)).toEqual([]); // box color only (or nothing)
		expect(strip(l)).not.toMatch(/\s{10,}$/);
	});

	it("tools.shiki=false still gets the backgrounds and word marks (they do not depend on the highlighter)", async () => {
		const s = await run(h, edit, { "code.ts": src }, withTheme("dark", { shiki: false }));
		await new Promise((r) => setTimeout(r, 1000));
		expect(tints(ansiLine(s, "hello")).length).toBe(2); // row + changed words
	});

	it("a theme without a box background keeps the foreground-only look (no 48;2 on the row)", async () => {
		const s = await run(h, edit, { "code.ts": src }, { lumen: { quota: { enabled: false } } }); // isolated default theme has no box bg
		await waitHighlighted(s, "hello");
		expect(bgColors(ansiLine(s, "hello"))).toEqual([]);
	});
});
