import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ansiLine, DUR, hasPi, hasTmux, numbered, png, sgrCount, useSession } from "./harness.ts";
import type { Step, ToolCall } from "./mock-server.ts";

const files = { "a.txt": numbered(5), "num.txt": numbered(100), "big.txt": numbered(3000), "pixel.png": png, "code.ts": "const a = 1;\nconst b = 2;\n" };
const call = (name: string, args: Record<string, unknown>): Step[] => [{ toolCalls: [{ name, args }] }, { text: "fine" }];
const responder = (steps: Step[]) => (i: number) => steps[i] ?? { text: "fine" };

/** Run one prompt to completion and return the settled screen. */
async function run(h: ReturnType<typeof useSession>, steps: Step[], extra: { files?: Record<string, string | Buffer>; settings?: Record<string, unknown> } = {}) {
	const s = await h.start({ responder: responder(steps), files: extra.files ?? files, settings: extra.settings });
	s.send("go");
	await s.waitFor("fine", 30_000);
	await s.settle();
	return s;
}

describe.skipIf(!hasTmux || !hasPi)("read", () => {
	const h = useSession();

	it("collapsed: header, exact line count, duration and expand hint; nothing else", async () => {
		const s = await run(h, call("read", { path: "a.txt" }));
		const screen = s.screen();
		expect(screen).toMatch(/● Read \(a\.txt\)\n\s+└ 5 lines · /);
		expect(screen).toMatch(new RegExp(`└ 5 lines · ${DUR}`));
		expect(screen).toMatch(/└ 5 lines · [^\n]*· ctrl\+o to expand/);
		expect(screen).not.toContain("line 3");
	});

	it("ctrl+o expands to a numbered gutter and collapses again", async () => {
		const s = await run(h, call("read", { path: "a.txt" }));
		s.press("C-o");
		await s.waitFor("Tool output: expanded");
		const open = s.screen();
		for (let i = 1; i <= 5; i++) expect(open).toMatch(new RegExp(`${i} │ line ${i}\\b`));
		expect(open).not.toContain("ctrl+o to expand");
		expect(open).toMatch(/─{20,}/);
		s.press("C-o");
		await s.waitGone("line 3");
		expect(s.screen()).toContain("ctrl+o to expand");
	});

	it("offset/limit: range in the header, real first line number, continuation notice kept out of the count", async () => {
		const s = await run(h, call("read", { path: "num.txt", offset: 10, limit: 5 }));
		expect(s.screen()).toMatch(/● Read \(num\.txt :10\+5\)\n\s+└ 5 lines · /);
		s.press("C-o");
		await s.waitFor("line 14");
		const open = s.screen();
		expect(open).toMatch(/10 │ line 10/);
		expect(open).toMatch(/14 │ line 14/);
		expect(open).toContain("[87 more lines in file. Use offset=15 to continue.]");
	});

	it("truncated file: 2000 lines, 'truncated from 3000' in warning", async () => {
		const s = await run(h, call("read", { path: "big.txt" }));
		expect(s.screen()).toContain("└ 2000 lines (truncated from 3000)");
	});

	it("preview is capped by tools.previewLines with a remaining-lines marker", async () => {
		const s = await run(h, call("read", { path: "num.txt" }), { settings: { lumen: { quota: { enabled: false }, tools: { previewLines: 3 } } } });
		s.press("C-o");
		await s.waitFor("… 97 more lines");
		const open = s.screen();
		expect(open).toMatch(/3 │ line 3/);
		expect(open).not.toContain("line 4");
	});

	it("missing file: error text on the result row, red dot", async () => {
		const s = await run(h, call("read", { path: "nope.txt" }));
		expect(s.screen()).toMatch(/● Read \(nope\.txt\)\n\s+└ ENOENT: no such file or directory/);
		expect(s.screen()).not.toContain("ctrl+o to expand");
	});

	it("image: 'image' summary instead of a line count", async () => {
		const s = await run(h, call("read", { path: "pixel.png" }));
		expect(s.screen()).toMatch(/● Read \(pixel\.png\)\n\s+└ image · /);
		expect(s.screen()).not.toMatch(/pixel\.png\)\n\s+└ \d+ lines/);
	});

	it("syntax highlighting: known languages get more colors than plain text", async () => {
		const s = await run(h, call("read", { path: "code.ts" }));
		s.press("C-o");
		await s.waitFor("1 │");
		const ts = sgrCount(ansiLine(s, "const a"));
		expect(ts).toBeGreaterThan(sgrCount("\x1b[2m1 │\x1b[0m"));
		const plain = await run(h, call("read", { path: "a.txt" }));
		plain.press("C-o");
		await plain.waitFor("1 │");
		expect(ts).toBeGreaterThan(sgrCount(ansiLine(plain, "line 1")));
	});
});

describe.skipIf(!hasTmux || !hasPi)("read with Shiki", () => {
	const h = useSession();
	const ts = { "code.ts": "const a = 1;\nfunction f(x: number): string { return `v${x}`; }\n" };

	it("expanded body switches to Shiki (24-bit colors) once the grammar is loaded", async () => {
		const s = await run(h, call("read", { path: "code.ts" }), { files: ts });
		s.press("C-o");
		await s.waitFor("1 │");
		for (let i = 0; i < 40 && !/38;2;/.test(ansiLine(s, "function f")); i++) await new Promise((r) => setTimeout(r, 250));
		expect(ansiLine(s, "function f")).toMatch(/38;2;/);
	});

	it("tools.shiki=false keeps pi's highlighter (no 24-bit colors)", async () => {
		const s = await run(h, call("read", { path: "code.ts" }), { files: ts, settings: { lumen: { quota: { enabled: false }, tools: { shiki: false } } } });
		s.press("C-o");
		await s.waitFor("1 │");
		await new Promise((r) => setTimeout(r, 1500));
		expect(ansiLine(s, "function f")).not.toMatch(/38;2;/);
	});
});

describe.skipIf(!hasTmux || !hasPi)("narrow terminal", () => {
	const h = useSession();
	const cmd = "echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa && echo bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

	it("collapsed rows stay on one line each and never wrap into fragments", async () => {
		const s = await h.start({ responder: responder(call("bash", { command: cmd })), files, cols: 40 });
		s.send("go");
		await s.waitFor("fine", 30_000);
		await s.settle();
		const lines = s.screen().split("\n");
		const head = lines.findIndex((l) => l.includes("● Bash"));
		expect(lines[head]).toMatch(/…$/);
		expect(lines[head + 1]).toMatch(/^\s+└ exit 0/);
		expect(lines[head + 2]).not.toMatch(/bbbb/);
	});

	it("expanded: rules fit the width, rows are cut, nothing overflows", async () => {
		const s = await h.start({ responder: responder(call("read", { path: "a.txt" })), files, cols: 40 });
		s.send("go");
		await s.waitFor("fine", 30_000);
		await s.settle();
		s.press("C-o");
		await s.waitFor("1 │");
		await s.settle();
		const rows = s.screen().split("\n");
		for (const r of rows) expect(r.length).toBeLessThanOrEqual(40);
		expect(rows.filter((l) => /^ +─{5,}$/.test(l)).length).toBeGreaterThanOrEqual(2);
	});
});

describe.skipIf(!hasTmux || !hasPi)("bash", () => {
	const h = useSession();

	it("success: exit 0, line count, duration; output hidden until expanded", async () => {
		const s = await run(h, call("bash", { command: "seq 1 3 | sed 's/^/out-/'" }));
		expect(s.screen()).toMatch(new RegExp(`● Bash \\(seq 1 3 \\| sed 's/\\^/out-/'\\)\\n\\s+└ exit 0 · 3 lines · ${DUR}`));
		expect(s.screen()).not.toContain("out-2");
		expect(s.screen()).toMatch(/└ exit 0 · 3 lines · [^\n]*· ctrl\+o to expand/);
		s.press("C-o");
		await s.waitFor("out-3");
		expect(s.screen()).toMatch(/out-1\n\s+out-2\n\s+out-3/);
	});

	it("failure: exit code, line count and last line inline; timeout shown in the header", async () => {
		const s = await run(h, call("bash", { command: "echo out; echo boom >&2; exit 3", timeout: 5 }));
		expect(s.screen()).toContain("● Bash (echo out; echo boom >&2; exit 3 · timeout 5s)");
		expect(s.screen()).toMatch(/└ exit 3 · 2 lines · boom · /);
		s.press("C-o");
		await s.waitFor("out");
		expect(s.screen()).toMatch(/exit 3 · 2 lines · [^\n]+\n\s+─{10,}\n\s+out\n\s+boom\n\s+─{10,}/);
	});

	it("default: no clock time on the row (the stamps already show it)", async () => {
		const s = await run(h, call("bash", { command: "seq 1 3" }));
		const row = s.screen().split("\n").find((l) => l.includes("└ exit 0")) ?? "";
		expect(row).toMatch(new RegExp(`└ exit 0 · 3 lines · ${DUR} · ctrl\\+o to expand$`));
		expect(row).not.toMatch(/\d\d:\d\d:\d\d/);
	});

	it("shows the wall-clock start time after the duration once it is far enough from the last one (tools.timeGapSec)", async () => {
		const re = new RegExp(`└ exit 0 · 3 lines · ${DUR} · \\d\\d:\\d\\d:\\d\\d`);
		const s = await h.start({ responder: responder(call("bash", { command: "seq 1 3" })), settings: { lumen: { quota: { enabled: false }, tools: { time: true, timeGapSec: 0 } } } });
		s.send("go");
		await s.waitFor("fine", 20_000);
		await s.settle();
		expect(s.screen()).toMatch(re);
	});

	it("tools.time=false hides it", async () => {
		const off = await h.start({ responder: responder(call("bash", { command: "seq 1 3" })), settings: { lumen: { quota: { enabled: false }, tools: { time: false, timeGapSec: 0 } } } });
		off.send("go");
		await off.waitFor("fine", 20_000);
		await off.settle();
		expect(off.screen()).toMatch(new RegExp(`└ exit 0 · 3 lines · ${DUR} · ctrl\\+o to expand$`, "m"));
		const row = off.screen().split("\n").find((l) => l.includes("└ exit 0")) ?? "";
		expect(row).not.toMatch(/\d\d:\d\d:\d\d/);
	});

	it("the time is stored in the tool result details (survives resume), not as extra entries", async () => {
		const s = await h.start({ responder: responder(call("bash", { command: "echo hi" })), persist: true, settings: { lumen: { quota: { enabled: false }, tools: { time: true, timeGapSec: 0 } } } });
		s.send("go");
		await s.waitFor("fine", 20_000);
		await s.settle();
		const dir = join(s.cwd, ".sessions");
		const file = readdirSync(dir, { recursive: true, encoding: "utf8" }).find((f) => f.endsWith(".jsonl"));
		const lines = readFileSync(join(dir, file ?? ""), "utf8").trim().split("\n").map((l) => JSON.parse(l));
		const result = lines.find((e) => e.message?.role === "toolResult");
		expect(typeof result?.message.details?.lumenAt).toBe("number");
		expect(Math.abs(result.message.details.lumenAt - Date.now())).toBeLessThan(60_000);
		expect(JSON.stringify(result.message.content)).not.toContain("lumenAt");
	});

	it("no output: says so instead of counting the placeholder as a line", async () => {
		const s = await run(h, call("bash", { command: "true" }));
		expect(s.screen()).toMatch(/└ exit 0 · no output · /);
		expect(s.screen()).not.toContain("(no output)");
	});

	it("huge output: 2000 lines (not 2002) and a 'truncated' flag", async () => {
		const s = await run(h, call("bash", { command: "seq 1 5000" }));
		expect(s.screen()).toMatch(/└ exit 0 · 2000 lines · truncated · /);
	});

	it("multi-line commands keep their real lines under the header (no ⏎ flattening); long ones are cut", async () => {
		const long = `echo ${"x".repeat(200)}`;
		const s = await run(h, [{ toolCalls: [{ name: "bash", args: { command: "echo a\necho b" } }, { name: "bash", args: { command: long } }] }, { text: "fine" }]);
		expect(s.screen()).toMatch(/● Bash\n\s+│ echo a\n\s+│ echo b\n\s+└ exit 0/);
		expect(s.screen()).not.toContain("⏎");
		const screen = s.screen();
		// one row, cut with an ellipsis at the terminal width well before 200 chars
		const row = /● Bash \(echo\s+x+…/.exec(screen)?.[0] ?? "";
		expect(row).not.toBe("");
		expect(row.replace(/\s+/g, "").length).toBeLessThan(130);
	});

	it("while running: warning row with live line count, then the final summary", async () => {
		const s = await h.start({ responder: responder(call("bash", { command: "for i in 1 2 3; do echo tick $i; sleep 1; done" })) });
		s.send("go");
		await s.waitFor(/└ running · [12] lines?/, 20_000);
		expect(s.screen()).toContain("● Bash (for i in 1 2 3");
		await s.waitFor("fine", 20_000);
		await s.settle();
		expect(s.screen()).toMatch(/└ exit 0 · 3 lines · 3\.\ds/);
		expect(s.screen()).not.toContain("running ·");
	});

	it("user `!cmd` shell escapes use pi's own box (not the compact row)", async () => {
		const s = await h.start({ responder: () => ({ text: "x" }) });
		s.send("!echo native-bash-ok");
		await s.waitFor(/^ native-bash-ok$/m);
		expect(s.screen()).toContain("$ echo native-bash-ok");
		expect(s.screen()).not.toContain("● Bash");
	});
});

describe.skipIf(!hasTmux || !hasPi)("edit", () => {
	const h = useSession();
	const edit = (edits: Array<{ oldText: string; newText: string }>) => call("edit", { path: "code.ts", edits });

	it("single edit: +N -N summary, expand hint, file changed on disk", async () => {
		const s = await run(h, edit([{ oldText: "const a = 1;", newText: "const a = 10;" }]));
		expect(s.screen()).toMatch(new RegExp(`● Edit \\(code\\.ts\\)\\n\\s+└ \\+1 -1 · ${DUR}\\n\\s+─{10,}\\n\\s+-1 const a = 1;\\n\\s+\\+1 const a = 10;`));
		expect(s.screen()).not.toContain("ctrl+o to expand"); // the whole change is already visible
		expect(readFileSync(join(s.cwd, "code.ts"), "utf8")).toBe("const a = 10;\nconst b = 2;\n");
	});

	it("expanded: the diff with removed/added lines", async () => {
		const s = await run(h, edit([{ oldText: "const a = 1;", newText: "const a = 10;" }]));
		s.press("C-o");
		await s.waitFor("+1 const a = 10;");
		expect(s.screen()).toMatch(/-1 const a = 1;\n\s+\+1 const a = 10;/);
	});

	it("several edits: count in the header and summed +/- totals", async () => {
		const s = await run(h, edit([{ oldText: "const a = 1;", newText: "const a = 10;" }, { oldText: "const b = 2;", newText: "const b = 20;\nconst c = 3;" }]));
		expect(s.screen()).toMatch(/● Edit \(code\.ts · 2 edits\)\n\s+└ \+3 -2 · /);
	});

	it("failed edit: the error replaces the summary and the file is untouched", async () => {
		const s = await run(h, edit([{ oldText: "NOPE", newText: "x" }]));
		expect(s.screen()).toMatch(/● Edit \(code\.ts\)\n\s+└ Could not find the exact text in code\.ts/);
		expect(readFileSync(join(s.cwd, "code.ts"), "utf8")).toBe("const a = 1;\nconst b = 2;\n");
	});
});

describe.skipIf(!hasTmux || !hasPi)("write", () => {
	const hw = useSession();
	it("shows the written content as added lines, capped by tools.changeLines with an expand hint", async () => {
		const body = Array.from({ length: 20 }, (_, i) => `row ${i + 1}`).join("\n");
		const s = await hw.start({ responder: responder(call("write", { path: "w.txt", content: body })), files });
		s.send("go");
		await s.waitFor("fine", 20_000);
		await s.settle();
		expect(s.screen()).toMatch(/└ wrote 20 lines · [^\n]*· ctrl\+o to expand/);
		expect(s.screen()).toMatch(/12 \+ row 12/);
		expect(s.screen()).toContain("… 8 more lines");
		expect(s.screen()).not.toContain("row 13");
		s.press("C-o");
		await s.waitFor("20 + row 20");
	});

	const h = useSession();

	it("new file in a new directory: line count, file on disk", async () => {
		const s = await run(h, call("write", { path: "out/new.txt", content: "a\nb\nc\n" }));
		expect(s.screen()).toMatch(new RegExp(`● Write \\(out/new\\.txt\\)\\n\\s+└ wrote 3 lines · ${DUR}`));
		expect(readFileSync(join(s.cwd, "out/new.txt"), "utf8")).toBe("a\nb\nc\n");
	});

	it("single line is singular", async () => {
		const s = await run(h, call("write", { path: "one.txt", content: "only" }));
		expect(s.screen()).toMatch(/└ wrote 1 line · /);
	});

	it("error (parent is a file): message on the result row", async () => {
		const s = await run(h, call("write", { path: "a.txt/x.txt", content: "x" }));
		expect(s.screen()).toMatch(/● Write \(a\.txt\/x\.txt\)\n\s+└ (?:ENOTDIR|EEXIST|Error|.*not a directory)/i);
		expect(s.screen()).not.toContain("wrote");
	});
});

describe.skipIf(!hasTmux || !hasPi)("tool row chrome", () => {
	const h = useSession();

	it("parallel tool calls render one compact row each, in order", async () => {
		const calls: ToolCall[] = [{ name: "read", args: { path: "a.txt" } }, { name: "bash", args: { command: "echo hi" } }];
		const s = await run(h, [{ toolCalls: calls }, { text: "fine" }]);
		expect(s.screen()).toMatch(/● Read \(a\.txt\)\n\s+└ 5 lines[\s\S]*● Bash \(echo hi\)\n\s+└ exit 0 · 1 line/);
	});

	it("dot colors: success and error differ, both differ from the running (warning) color", async () => {
		const ok = await run(h, call("read", { path: "a.txt" }));
		const okDot = /(\x1b\[[0-9;]*m)+●/.exec(ansiLine(ok, "●"))?.[0];
		const bad = await run(h, call("read", { path: "nope.txt" }));
		const badDot = /(\x1b\[[0-9;]*m)+●/.exec(ansiLine(bad, "●"))?.[0];
		expect(okDot).toBeDefined();
		expect(badDot).toBeDefined();
		expect(okDot).not.toBe(badDot);
	});

	it("tools.enabled=false restores pi's native rendering", async () => {
		const s = await run(h, call("bash", { command: "echo hi" }), { settings: { lumen: { quota: { enabled: false }, tools: { enabled: false } } } });
		expect(s.screen()).not.toContain("● Bash");
		expect(s.screen()).not.toContain("└ exit");
		expect(s.screen()).toContain("$ echo hi");
	});

	it("unknown tools are reported by pi, not swallowed", async () => {
		const s = await h.start({ responder: responder([{ toolCalls: [{ name: "frobnicate", args: {} }] }, { text: "fine" }]) });
		s.send("go");
		await s.waitFor("fine");
		expect(s.screen()).toContain("Tool frobnicate not found");
	});
});
