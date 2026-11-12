import { describe, expect, it } from "vitest";
import { cleanText, extensionName, formatStatusReport, groupLoaded, statusLabel } from "../src/status.ts";

const src = (source: string, path: string, origin = "package") => ({ source, path, origin });

describe("status report", () => {
	it("cleans escapes, newlines and extra spaces", () => {
		expect(cleanText("\x1b[32mok\x1b[0m\n  synced\t2m")).toBe("ok synced 2m");
		expect(cleanText("\x1b]8;;http://x\x07link\x1b]8;;\x07")).toBe("link");
	});

	it("labels known keys, leaves unknown ones", () => {
		expect(statusLabel("sync")).toBe("pi-sync");
		expect(statusLabel("pi-lens-lsp")).toBe("pi-lens · LSP");
		expect(statusLabel("whatever")).toBe("whatever");
	});

	it("lists every status, sorted and aligned, without ANSI", () => {
		const text = formatStatusReport({
			header: "pi-lumen on",
			statuses: new Map([
				["pi-lens-lsp", "\x1b[2mts · py\x1b[0m"],
				["sync", "synced 2m ago"],
				["empty", "  "],
			]),
			loaded: [],
		});
		expect(text).toBe(["pi-lumen on", "", "Extension status", "  pi-lens · LSP  ts · py", "  pi-sync        synced 2m ago"].join("\n"));
	});

	it("says so when nothing is published or unavailable", () => {
		expect(formatStatusReport({ header: "h", statuses: new Map(), loaded: [] })).toContain("no extension has published a status");
		expect(formatStatusReport({ header: "h", statuses: undefined, unavailable: "off", loaded: [] })).toContain("  off");
	});

	it("names extensions by package source or file", () => {
		expect(extensionName(src("npm:pi-lens", "/x/dist/index.js"))).toBe("npm:pi-lens");
		expect(extensionName(src("local", "/home/me/ext/foo.ts", "top-level"))).toBe("foo");
		expect(extensionName(src("local", "/home/me/ext/bar/index.ts", "top-level"))).toBe("bar");
		expect(extensionName(src("builtin", "builtin:read", "top-level"))).toBe("pi (built-in)");
		expect(extensionName(undefined)).toBe("?");
	});

	it("groups commands (extension ones only) and tools per extension, built-ins last", () => {
		const lens = src("npm:pi-lens", "/x");
		const sync = src("npm:pi-sync", "/y");
		const loaded = groupLoaded(
			[
				{ source: "extension", info: lens },
				{ source: "extension", info: lens },
				{ source: "skill", info: lens },
				{ source: "extension", info: sync },
			],
			[{ info: lens }, { info: src("builtin", "builtin:bash", "top-level") }],
		);
		expect(loaded).toEqual([
			{ name: "npm:pi-lens", commands: 2, tools: 1 },
			{ name: "npm:pi-sync", commands: 1, tools: 0 },
			{ name: "pi (built-in)", commands: 0, tools: 1 },
		]);
		const text = formatStatusReport({ header: "h", statuses: new Map(), loaded });
		expect(text).toContain("Loaded (3)");
		expect(text).toContain("npm:pi-lens    2 commands · 1 tool");
		expect(text).toContain("npm:pi-sync    1 command");
	});
});
