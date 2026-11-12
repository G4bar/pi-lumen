import { describe, expect, it } from "vitest";
import { hasPi, hasTmux, useSession } from "./harness.ts";
import type { Step } from "./mock-server.ts";

const COLS = 120;
const BORDER = /^─{20,}$/;
const respond = (steps: Step[]) => (i: number) => steps[i] ?? { text: "fine" };

/** Lines of the prompt box: top border, content, bottom border (status line is the last row). */
function promptBox(screen: string): { top: number; lines: string[] } {
	const lines = screen.split("\n");
	const bottom = lines.length - 2; // last row = status line
	let top = bottom - 1;
	while (top > 0 && !(BORDER.test(lines[top] ?? "") || /^─+ .*─+$/.test(lines[top] ?? ""))) top--;
	return { top, lines: lines.slice(top, bottom + 1) };
}

describe.skipIf(!hasTmux || !hasPi)("prompt box", () => {
	const h = useSession();

	it("idle: pi's own editor, no glyph: full-width borders around one empty line (3 rows)", async () => {
		const s = await h.start({ responder: respond([]) });
		const { lines } = promptBox(s.screen());
		expect(lines).toHaveLength(3);
		expect(lines[0]).toMatch(BORDER);
		expect(lines[0]?.length).toBe(COLS);
		expect(lines[1]?.trim()).toBe("");
		expect(lines[2]).toMatch(BORDER);
		expect(s.screen()).not.toContain("❯");
	});

	it("typed text starts at the left edge and wraps normally", async () => {
		const s = await h.start({ responder: respond([]) });
		s.type("hello world");
		await s.waitFor("hello world");
		s.type(` ${"abc ".repeat(40)}`);
		await s.waitFor(/abc abc abc/);
		const { lines } = promptBox(s.screen());
		expect(lines.length).toBeGreaterThan(3);
		expect(lines[1]).toMatch(/^\s?hello world/);
		expect(s.screen()).not.toContain("❯");
	});

	it("`Working` lives in the prompt's top border while streaming, and the box keeps its height", async () => {
		const s = await h.start({ responder: respond([{ text: "slow answer ".repeat(8), chunkDelayMs: 150 }]) });
		s.send("go");
		await s.waitFor(/Working/);
		const screen = s.screen();
		const row = screen.split("\n").find((l) => l.includes("Working")) ?? "";
		expect(row).toMatch(/^─+ .*Working.* ─+$/);
		expect(row.length).toBe(COLS);
		const { lines } = promptBox(screen);
		expect(lines).toHaveLength(3);
		expect(lines[0]).toContain("Working");
		expect(screen.split("\n").filter((l) => l.includes("Working"))).toHaveLength(1);
		await s.waitGone(/Working/, 20_000);
		expect(promptBox(s.screen()).lines[0]).toMatch(BORDER);
	});
});

describe.skipIf(!hasTmux || !hasPi)("status line", () => {
	const h = useSession();

	it("below the prompt by default: model, thinking level, context, cost, dir", async () => {
		const s = await h.start({ responder: respond([]) });
		const last = s.screen().split("\n").at(-1) ?? "";
		expect(last).toMatch(/^mock · Mock Model │ \[med\] │ 0\/200k 0% │ \$0\.00 │ project$/);
	});

	it("updates after a reply: tokens used, throughput", async () => {
		const s = await h.start({ responder: respond([{ text: "hello" }]) });
		s.send("go");
		await s.waitFor("hello");
		await s.settle();
		await s.waitFor(/140\/200k/);
		expect(s.screen().split("\n").at(-1)).toMatch(/140\/200k 0%/);
	});

	it("placement above puts it over the prompt box", async () => {
		const s = await h.start({ responder: respond([]), settings: { lumen: { quota: { enabled: false }, placement: "above" } } });
		const lines = s.screen().split("\n");
		const status = lines.findIndex((l) => l.startsWith("mock · Mock Model"));
		const top = lines.findIndex((l) => BORDER.test(l));
		expect(status).toBeGreaterThan(-1);
		expect(status).toBeLessThan(top);
		expect(lines.at(-1)).toMatch(BORDER);
	});

	it("/lumen placement toggle moves it at runtime; /lumen reports state", async () => {
		const s = await h.start({ responder: respond([]) });
		s.send("/lumen");
		await s.waitFor("pi-lumen on · placement below");
		s.send("/lumen placement above");
		await s.waitFor("placement above");
		const lines = s.screen().split("\n");
		expect(lines.findIndex((l) => l.startsWith("mock · Mock Model"))).toBeLessThan(lines.findIndex((l) => BORDER.test(l)));
	});

	it("/lumen off restores pi's own footer and editor", async () => {
		const s = await h.start({ responder: respond([]) });
		s.send("/lumen off");
		await s.waitFor("pi-lumen off");
		await s.waitGone(/^mock · Mock Model │/m);
		expect(s.screen()).not.toContain("❯");
	});
});

describe.skipIf(!hasTmux || !hasPi)("assistant messages", () => {
	const h = useSession();

	it("markdown: headings, emphasis, lists and fenced code are rendered (no raw markers)", async () => {
		const md = "# Titolo\n\nUna **risposta** con `codice`.\n\n- uno\n- due\n\n```ts\nconst x = 1;\n```";
		const s = await h.start({ responder: respond([{ text: md }]) });
		s.send("go");
		await s.waitFor("const x = 1;");
		const screen = s.screen();
		expect(screen).toContain("Titolo");
		expect(screen).not.toContain("# Titolo");
		expect(screen).toContain("Una risposta con codice.");
		expect(screen).not.toContain("**");
		expect(screen).toMatch(/- uno\n\s*- due/);
	});

	it("timestamps: one dim, right-aligned HH:mm:ss under the user message and one under the final reply", async () => {
		const s = await h.start({ responder: respond([{ toolCalls: [{ name: "bash", args: { command: "echo hi" } }] }, { text: "fine" }]) });
		s.send("go");
		await s.waitFor("fine");
		await s.settle();
		await s.waitFor(/fine\n+\s+\d\d:\d\d:\d\d/);
		const stamps = s.screen().split("\n").filter((l) => /^\s+\d\d:\d\d:\d\d$/.test(l));
		expect(stamps).toHaveLength(2); // user + final assistant, not the intermediate tool-use turn
		for (const l of stamps) expect(l.length).toBe(COLS);
		const lines = s.screen().split("\n");
		expect(lines.findIndex((l) => l.trim() === "go") + 1).toBeLessThan(lines.findIndex((l) => l.includes("● Bash")));
	});

	it("stamp.enabled=false removes them", async () => {
		const s = await h.start({ responder: respond([{ text: "fine" }]), settings: { lumen: { quota: { enabled: false }, stamp: { enabled: false } } } });
		s.send("go");
		await s.waitFor("fine");
		await s.settle();
		expect(s.screen()).not.toMatch(/\d\d:\d\d:\d\d/);
	});

	it("thinking shown by default: the reasoning text is visible", async () => {
		const s = await h.start({ responder: respond([{ thinking: "Sto ragionando un po'.", text: "Risposta." }]) });
		s.send("go");
		await s.waitFor("Risposta.");
		expect(s.screen()).toContain("Sto ragionando un po'.");
	});
});

describe.skipIf(!hasTmux || !hasPi)("hidden thinking labels (one per row)", () => {
	const h = useSession();
	const steps = (i: number): Step => {
		if (i % 2 === 0) return { thinking: "Primo pensiero lungo abbastanza. ".repeat(4), chunkDelayMs: i === 2 ? 250 : 0, toolCalls: [{ name: "bash", args: { command: "echo hi" } }] };
		return { thinking: "Ultimo pensiero.", text: "Fatto." };
	};

	it("old rows stay at their own `Thought for …` while the current one ticks `Thinking… Ns`", async () => {
		const s = await h.start({ responder: steps, settings: { hideThinkingBlock: true } });
		s.send("uno");
		await s.waitFor("Fatto.");
		await s.settle();
		s.send("due");
		await s.waitFor(/Thinking… \d+(?:s|ms)/, 15_000);
		const live = s.screen();
		expect(live.match(/Thinking… /g)).toHaveLength(1);
		expect(live.match(/Thought for /g)?.length).toBeGreaterThanOrEqual(2);
		await s.waitFor(/Fatto\.[\s\S]*Fatto\./);
		await s.settle();
		const done = s.screen();
		expect(done).not.toContain("Thinking…");
		expect(done.match(/Thought for /g)).toHaveLength(4);
		expect(done).not.toContain("Thinking...");
	});
});
