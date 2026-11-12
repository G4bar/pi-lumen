/**
 * Compact tool rows: `● Name (arg)` and `  └ result · duration`.
 * Inspired by heyhuynhgiabuu/pi-pretty v0.10.0 (MIT): renderers only, no execution changes.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { formatToolDuration } from "../time.ts";
import { formatAt } from "./at.ts";

export interface RowContext {
	isPartial: boolean;
	isError: boolean;
	expanded: boolean;
	durationMs: number | undefined;
	lastComponent: unknown;
	keyHint(keybinding: Parameters<RowHints["keyHint"]>[0], description: string): string;
}
type RowHints = import("@earendil-works/pi-coding-agent").KeybindingHints;

const MAX_ARG = 110;

/** Marks a full-width rule row; replaced by `─` × (width − 2) at render time, so it always fits the real viewport. */
const RULE = "\u0001";
const INDENT = 2;

/**
 * Row block that fits whatever width pi renders it at: every row is cut to the width with `…` (rows never wrap into
 * unindented fragments in a narrow terminal), except when `wrap` is set (an expanded call header, where the full
 * command should stay readable). Rules are drawn at the real width.
 */
export class Block implements Component {
	constructor(
		private content = "",
		private wrap = false,
	) {}
	set(content: string, wrap: boolean): void {
		this.content = content;
		this.wrap = wrap;
	}
	invalidate(): void {}
	render(width: number): string[] {
		if (!this.content.trim()) return [];
		const w = Math.max(1, width);
		return this.content.split("\n").flatMap((row) => {
			if (row.includes(RULE)) return [row.replace(RULE, "─".repeat(Math.max(1, w - INDENT)))];
			return this.wrap ? wrapTextWithAnsi(row, w) : [truncateToWidth(row, w, "…")];
		});
	}
}

/** Reuse the previous Block instance when possible. */
export function textOf(ctx: { lastComponent: unknown }, content: string, wrap = false): Block {
	const t = ctx.lastComponent instanceof Block ? ctx.lastComponent : new Block();
	t.set(content, wrap);
	return t;
}

export function oneLine(s: string, max = MAX_ARG): string {
	const flat = s.replace(/\s*\n\s*/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** `● Read (src/a.ts)` — dot is warning while running, then success/error. */
export function callLine(theme: Theme, ctx: Pick<RowContext, "isPartial" | "isError" | "expanded">, name: string, arg?: string): string {
	let color: "warning" | "error" | "success" = "success";
	if (ctx.isPartial) color = "warning";
	else if (ctx.isError) color = "error";
	let out = `${theme.fg(color, "●")} ${theme.fg("toolTitle", theme.bold(name))}`;
	if (arg) out += ` ${theme.fg("dim", "(")}${theme.fg("accent", ctx.expanded ? arg : oneLine(arg))}${theme.fg("dim", ")")}`;
	return out;
}

/** `  └ summary · 0.02s · 14:32:07`; `summary` is already styled, `at` is the start time (ms). */
export function resultLine(theme: Theme, summary: string, durationMs?: number, at?: number): string {
	const dur = durationMs === undefined ? "" : theme.fg("dim", ` · ${formatToolDuration(durationMs)}`);
	const when = at === undefined ? "" : theme.fg("dim", ` · ${formatAt(at)}`);
	return `${theme.fg("dim", "  └")} ${summary}${dur}${when}`;
}

/** ` · ctrl+o to expand` / `to collapse`, appended to the result row so the body needs no hint line of its own. */
export function expandHint(theme: Theme, ctx: Pick<RowContext, "keyHint">, expanded: boolean): string {
	return theme.fg("dim", ` · ${ctx.keyHint("app.tools.expand", expanded ? "to collapse" : "to expand")}`);
}

/** Framed body: full-width dim rule, `rows` indented to the `└`, closing rule. `rows` are already styled. */
export function framed(theme: Theme, rows: string[], width?: number): string {
	const rule = `\n  ${theme.fg("dim", width === undefined ? RULE : "─".repeat(width))}`;
	return `${rule}${rows.map((r) => `\n  ${r}`).join("")}${rule}`;
}

/** The first `max` lines as framed rows, with a `… N more lines` marker when cut. */
export function framedLines(theme: Theme, lines: string[], max: number, paint: (line: string) => string = (l) => theme.fg("toolOutput", l), width?: number): string {
	const rows = lines.slice(0, max).map(paint);
	if (lines.length > max) rows.push(theme.fg("muted", `… ${lines.length - max} more lines`));
	return rows.length ? framed(theme, rows, width) : "";
}

/**
 * Body shown by default (changes of `edit`/`write`): `collapsedMax` rows, or `expandedMax` once expanded.
 * `toggle` tells whether expanding reveals anything, so the hint only appears when it is useful.
 */
export function changeBody(theme: Theme, rows: string[], expanded: boolean, collapsedMax: number, expandedMax: number): { body: string; toggle: boolean } {
	const max = expanded ? Math.max(expandedMax, collapsedMax) : collapsedMax;
	const shown = rows.slice(0, max);
	if (rows.length > max) shown.push(theme.fg("muted", `… ${rows.length - max} more lines`));
	return { body: shown.length ? framed(theme, shown) : "", toggle: rows.length > collapsedMax };
}

export function plural(n: number, one: string, many = `${one}s`): string {
	return `${n} ${n === 1 ? one : many}`;
}
