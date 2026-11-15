/**
 * Makes every tool row look like read/bash/edit/write: no pi tool-box background, `outputPad` applied by us.
 *
 * pi lets an extension decide how calls to *any* tool are drawn (`registerToolRenderer`). For tools that are not
 * ours (grep/find/ls, MCP and other extensions' tools):
 * - with renderers of their own, the same renderers run, wrapped in a flat shell (their content is untouched);
 * - without any (and for grep/find/ls, which print their results inline), a generic compact row is drawn:
 *   `● name (main arg)` and `└ N lines`, expandable.
 * Tools that already draw their own shell (`renderShell: "self"`) are left alone.
 */
import type { ExtensionAPI, ToolRenderers } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import type { LumenConfig } from "../config.ts";
import { rowAt } from "./at.ts";
import { type Box, boxBg, callLine, callOf, expandHint, framedLines, oneLine, paintRows, plural, resultLine, resultOf } from "./format.ts";

/** Tools with lumen's own renderers (registered separately). */
const OWN: ReadonlySet<string> = new Set(["read", "bash", "edit", "write"]);
/** pi's built-ins that print their results inline: drawn with the generic summary row like everything else. */
const SUMMARISED: ReadonlySet<string> = new Set(["grep", "find", "ls"]);
/** Argument names that best describe a call, in order of preference. */
const MAIN_ARGS = ["path", "pattern", "command", "query", "url", "file", "name"];

/** A foreign component inside our margins and tool box (what pi's own box would have drawn around it). */
export class Padded implements Component {
	constructor(
		public inner: Component,
		public pad: number,
		public box?: Box,
	) {}
	invalidate(): void {
		this.inner.invalidate?.();
	}
	render(width: number): string[] {
		return paintRows(this.inner.render(Math.max(1, width - 2 * this.pad)), width, this.pad, this.box);
	}
}

type AnyCtx = { lastComponent: unknown; outputPad?: number; isPartial?: boolean; isError?: boolean };
type ThemeLike = Parameters<typeof boxBg>[0];

/**
 * Run a renderer so that it sees (and reuses) its own component, which we keep inside a reusable `Padded`.
 * `part` says whether the rows open the box (call) or close it (result); the theme is the argument before `ctx`.
 */
function padded<A extends unknown[], C extends AnyCtx>(render: (...a: [...A, C]) => Component, part: "call" | "result"): (...a: [...A, C]) => Component {
	return (...args) => {
		const ctx = args.at(-1) as C;
		const theme = args.at(-2) as ThemeLike;
		const head = args.slice(0, -1) as A;
		const prev = ctx.lastComponent instanceof Padded ? ctx.lastComponent : undefined;
		const inner = render(...head, { ...ctx, lastComponent: prev?.inner } as C);
		const bg = boxBg(theme, ctx);
		const box = bg ? { bg, top: part === "call", bottom: part === "result" } : undefined;
		if (!prev) return new Padded(inner, ctx.outputPad ?? 1, box);
		prev.inner = inner;
		prev.pad = ctx.outputPad ?? 1;
		prev.box = box;
		return prev;
	};
}

const textOutput = (content: ReadonlyArray<{ type: string; text?: string }>): string => content.map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("\n");

/** The most telling argument of a call, as short text. */
export function describeArgs(args: unknown): string {
	if (typeof args !== "object" || args === null) return "";
	const rec = args as Record<string, unknown>;
	if (typeof rec.pattern === "string" && typeof rec.path === "string" && rec.pattern && rec.path) return `${rec.pattern} in ${rec.path}`;
	for (const k of MAIN_ARGS) {
		const v = rec[k];
		if (typeof v === "string" && v) return v;
	}
	if (!Object.keys(rec).length) return "";
	try {
		return JSON.stringify(rec);
	} catch {
		return "";
	}
}

/** Compact name: `mcp__docs__search` → `docs/search`; otherwise capitalised. */
export function displayName(tool: string): string {
	const m = /^mcp__(.+?)__(.+)$/.exec(tool);
	if (m) return `${m[1]}/${m[2]}`;
	return tool.charAt(0).toUpperCase() + tool.slice(1);
}

function genericRenderers(name: string, getCfg: () => LumenConfig): ToolRenderers {
	return {
		renderShell: "self",
		renderCall: (args, theme, ctx) => callOf(theme, ctx, callLine(theme, ctx, displayName(name), describeArgs(args)), ctx.expanded),
		renderResult: (result, { expanded, isPartial }, theme, ctx) => {
			const text = textOutput(result.content).trim();
			const lines = text ? text.split("\n") : [];
			if (isPartial) return resultOf(theme, ctx, resultLine(theme, theme.fg("muted", `running · ${plural(lines.length, "line")}`)));
			const at = rowAt(getCfg, result.details);
			if (ctx.isError) return resultOf(theme, ctx, resultLine(theme, theme.fg("error", oneLine(lines[0] ?? "error", 100)), ctx.durationMs, at));
			const empty = result.content.some((c) => c.type === "image") ? "image" : "done";
			const summary = theme.fg("success", lines.length ? plural(lines.length, "line") : empty);
			const hint = lines.length > 1 || expanded ? expandHint(theme, ctx, expanded) : "";
			const body = expanded ? framedLines(theme, lines, getCfg().tools.previewLines) : "";
			return resultOf(theme, ctx, resultLine(theme, summary, ctx.durationMs, at) + hint + body);
		},
	};
}

/** The same renderers inside a flat shell; a missing one falls back to the generic row. */
export function flatten(name: string, base: ToolRenderers | undefined, getCfg: () => LumenConfig): ToolRenderers | undefined {
	const generic = genericRenderers(name, getCfg);
	if (!base || SUMMARISED.has(name)) return generic;
	if (base.renderShell === "self") return base;
	return {
		renderShell: "self",
		renderCall: base.renderCall ? (padded(base.renderCall, "call")) : generic.renderCall,
		renderResult: base.renderResult ? (padded(base.renderResult, "result")) : generic.renderResult,
	};
}

export function registerUniformRows(pi: ExtensionAPI, getCfg: () => LumenConfig): void {
	if (typeof pi.registerToolRenderer !== "function") return; // older pi: only our own tools are flat
	pi.registerToolRenderer((toolName, next) => {
		const base = next();
		return OWN.has(toolName) ? base : flatten(toolName, base, getCfg);
	});
}
