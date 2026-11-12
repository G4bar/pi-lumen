import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "lumen-"));
process.env.PI_CODING_AGENT_DIR = dir;

const { LumenSession } = await import("../src/session.ts");

const theme = { fg: (_c: string, t: string) => t, bold: (t: string) => t, getThinkingBorderColor: () => (t: string) => t };

function fake() {
	const calls: Record<string, unknown[][]> = {};
	const rec = (name: string) =>
		vi.fn((...a: unknown[]) => {
			(calls[name] ??= []).push(a);
		});
	const ui = {
		theme,
		setFooter: rec("setFooter"),
		setWidget: rec("setWidget"),
		setWorkingIndicator: rec("setWorkingIndicator"),
		setHiddenThinkingLabel: rec("setHiddenThinkingLabel"),
		getEditorComponent: () => ({}), // slot taken → no prompt editor
		setEditorComponent: rec("setEditorComponent"),
	};
	const ctx = {
		mode: "tui",
		ui,
		cwd: "/home/x/proj",
		model: { provider: "openrouter", id: "m1", name: "Model One" },
		modelRegistry: { isUsingOAuth: () => false, getApiKeyForProvider: async () => undefined },
		sessionManager: {
			getBranch: () => [],
			getEntries: () => [{ type: "message", message: { role: "assistant", stopReason: "stop", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0.5 } } } }],
		},
		getContextUsage: () => ({ tokens: 1000, contextWindow: 200_000, percent: 0.5 }),
	};
	const pi = { getSettings: () => ({ hideThinkingBlock: true }), getThinkingLevel: () => "medium" };
	return { ctx, pi, calls };
}

describe("LumenSession", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("installs footer + widget below, renders a line with spend", () => {
		const { ctx, pi, calls } = fake();
		// biome-ignore lint/suspicious/noExplicitAny: minimal doubles
		const s = new LumenSession(pi as any, ctx as any);
		s.installUi();
		expect(calls.setFooter).toHaveLength(1);
		const [key, factory, opts] = calls.setWidget?.[0] as [string, (tui: unknown) => { render(w: number): string[] }, { placement: string }];
		expect(key).toBe("pi-lumen");
		expect(opts.placement).toBe("belowEditor");
		const comp = factory({ requestRender() {} });
		const [line] = comp.render(120);
		expect(line).toContain("openrouter · Model One");
		expect(line).toContain("[med]");
		expect(line).toContain("$0.50");
		s.dispose();
	});

	it("placement above re-installs the widget and persists without touching settings.json", () => {
		const { ctx, pi, calls } = fake();
		const s = new LumenSession(pi as any, ctx as any);
		s.installUi();
		s.setPlacement("above");
		const last = calls.setWidget?.at(-1) as [string, unknown, { placement: string }];
		expect(last[2].placement).toBe("aboveEditor");
		expect(JSON.parse(readFileSync(join(dir, "pi-lumen.json"), "utf8")).placement).toBe("above");
		s.dispose();
	});

	it("leaves no timers after thinking stops, after dispose, and bump throttling", () => {
		const { ctx, pi, calls } = fake();
		const s = new LumenSession(pi as any, ctx as any);
		s.installUi();
		const renders = vi.fn();
		(s as any).tui = { requestRender: renders };
		s.thinkingStart();
		expect(vi.getTimerCount()).toBe(1);
		vi.advanceTimersByTime(3000);
		// constant label: pi shares it across all thinking rows, so it must never tick
		expect(calls.setHiddenThinkingLabel?.every((c) => c[0] === "Thought")).toBe(true);
		s.thinkingStop();
		expect(calls.setHiddenThinkingLabel?.at(-1)?.[0]).toBe("Thought");
		vi.advanceTimersByTime(1000); // let a trailing throttle fire
		expect(vi.getTimerCount()).toBe(0);
		for (let i = 0; i < 20; i++) s.bump();
		expect(vi.getTimerCount()).toBe(1); // single trailing timer, not 20
		s.thinkingStart();
		s.dispose();
		expect(vi.getTimerCount()).toBe(0);
		s.dispose(); // idempotent
		s.thinkingStart(); // no-op after dispose
		expect(vi.getTimerCount()).toBe(0);
	});

	it("gives the footer back only while it is still ours", () => {
		const mk = (replaced: boolean) => {
			const { ctx, pi, calls } = fake();
			const s = new LumenSession(pi as any, ctx as any);
			s.installUi();
			const factory = calls.setFooter?.[0]?.[0] as (tui: unknown, theme: unknown, fd: unknown) => { dispose(): void };
			const comp = factory({ requestRender() {} }, theme, { onBranchChange: () => () => {}, getGitBranch: () => null, getExtensionStatuses: () => new Map() });
			if (replaced) comp.dispose(); // pi disposes our footer when another extension sets its own
			s.uninstallUi();
			return calls.setFooter?.filter((c) => c[0] === undefined).length ?? 0;
		};
		expect(mk(false)).toBe(1);
		expect(mk(true)).toBe(0);
	});

	it("does not re-push an unchanged hidden-thinking label (pi rebuilds every row on each call)", () => {
		const { ctx, pi, calls } = fake();
		const s = new LumenSession(pi as any, ctx as any);
		s.installUi();
		s.thinkingStart(1);
		const before = calls.setHiddenThinkingLabel?.length ?? 0;
		s.thinkingStart(1);
		s.thinkingStart(1);
		expect(calls.setHiddenThinkingLabel?.length).toBe(before);
		vi.advanceTimersByTime(1000); // label text changes → pushed again
		expect(calls.setHiddenThinkingLabel?.length).toBe(before + 1);
		s.dispose();
	});

	it("disabled config or non-tui mode makes zero UI calls", () => {
		const { ctx, pi, calls } = fake();
		(ctx as any).mode = "print";
		const s = new LumenSession(pi as any, ctx as any);
		s.installUi();
		s.thinkingStart();
		expect(vi.getTimerCount()).toBe(0);
		s.dispose();
		expect(Object.keys(calls).filter((k) => calls[k]?.length)).toEqual([]);
	});

	it("keeps extension statuses out of the line unless allowlisted; /status shows all", () => {
		const mk = (inlineStatusKeys: string[]) => {
			const { ctx, pi, calls } = fake();
			(pi as any).getCommands = () => [{ name: "sync", source: "extension", sourceInfo: { source: "npm:pi-sync", path: "/y", origin: "package" } }];
			(pi as any).getAllTools = () => [];
			const s = new LumenSession(pi as any, ctx as any);
			s.cfg.inlineStatusKeys = inlineStatusKeys;
			s.installUi();
			const factory = calls.setFooter?.[0]?.[0] as (tui: unknown, theme: unknown, fd: unknown) => unknown;
			factory({ requestRender() {} }, theme, {
				onBranchChange: () => () => {},
				getGitBranch: () => null,
				getExtensionStatuses: () => new Map([["sync", "synced 2m ago"], ["pi-lens-lsp", "ts · py"]]),
			});
			return s;
		};
		const clean = mk([]);
		expect(clean.renderLine(200)).not.toContain("synced");
		expect(clean.renderLine(200)).not.toContain("ts · py");
		const report = clean.statusReport();
		expect(report).toContain("pi-sync        synced 2m ago");
		expect(report).toContain("pi-lens · LSP  ts · py");
		expect(report).toContain("npm:pi-sync");
		clean.dispose();
		const inline = mk(["sync"]);
		expect(inline.renderLine(200)).toContain("synced 2m ago");
		expect(inline.renderLine(200)).not.toContain("ts · py");
		inline.dispose();
	});

	it("/status explains when statuses are unavailable and never throws", () => {
		const { ctx, pi } = fake();
		(pi as any).getCommands = () => {
			throw new Error("boom");
		};
		const s = new LumenSession(pi as any, ctx as any);
		expect(s.statusReport()).toContain("pi's own footer");
		(ctx as any).mode = "print";
		expect(s.statusReport()).toContain("outside the TUI");
		s.dispose();
	});

	it("never throws when the context is broken", () => {
		const { ctx, pi } = fake();
		(ctx as any).getContextUsage = () => {
			throw new Error("stale");
		};
		const s = new LumenSession(pi as any, ctx as any);
		expect(s.renderLine(80)).toBe("");
		s.dispose();
	});
});
