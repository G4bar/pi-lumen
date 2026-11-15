/**
 * Compact tool rows: `● Name (arg)` and `  └ result · duration`.
 * Inspired by heyhuynhgiabuu/pi-pretty v0.10.0 (MIT): renderers only, no execution changes.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
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
 * `FILL_OPEN + <bg SGR> [+ FILL_SEP + <restore SGR>] + FILL_CLOSE` at the end of a row: Block pads the row to the full
 * width with that background, then switches to `restore` (the tool box background) so the box's own right padding
 * column keeps the box color instead of showing a hole.
 */
const FILL_OPEN = "\u0002";
const FILL_SEP = "\u0004";
const FILL_CLOSE = "\u0003";
const FILL_RE = /\u0002([^\u0003\u0004]*)\u0004?([^\u0003]*)\u0003/;
export const fillRow = (row: string, bgOpen: string, restore = ""): string => `${row}${FILL_OPEN}${bgOpen}${restore ? FILL_SEP + restore : ""}${FILL_CLOSE}`;

/**
 * SGR that clears every attribute and the foreground but NOT the background (`22 23 24 25 27 28 29 39`).
 * pi paints the tool box background around the whole padded row, so a full reset (`ESC[0m`, which
 * `truncateToWidth` emits around its ellipsis) would leave the rest of the row, ellipsis and right padding included,
 * on the terminal's default background.
 */
const SOFT_RESET = "\x1b[22;23;24;25;27;28;29;39m";
const FULL_RESET_RE = /\x1b\[0?m/g;
/** Replace full resets with `SOFT_RESET` so the surrounding background survives. */
export const keepBackground = (s: string): string => s.replace(FULL_RESET_RE, SOFT_RESET);

/** A painted tool box around rows: `bg` is its background (ANSI), `top`/`bottom` add a blank padded row there. */
export interface Box {
	bg: string;
	top: boolean;
	bottom: boolean;
}

/**
 * Margins (`pad` columns each side) around `rows`, and, with a `box`, its background over the full width: padding
 * columns, content, the space up to the right edge and the optional blank rows above/below. Resets inside the
 * content (`ESC[0m`, `ESC[49m`) switch back to the box background instead of leaving the terminal's own one.
 * No rows → nothing (an empty row never draws a box).
 */
export function paintRows(rows: string[], width: number, pad: number, box?: Box): string[] {
	if (!rows.length) return [];
	const margin = " ".repeat(pad);
	if (!box) return rows.map((r) => (margin ? `${margin}${r}` : r));
	const { bg } = box;
	const blank = `${bg}${" ".repeat(width)}\x1b[49m`;
	const painted = rows.map((r) => {
		const inner = r.replace(/\x1b\[(?:0?|49)m/g, (m) => (m === "\x1b[49m" ? bg : `\x1b[0m${bg}`));
		return `${bg}${margin}${inner}${" ".repeat(Math.max(0, width - pad - visibleWidth(inner)))}\x1b[49m`;
	});
	return [...(box.top ? [blank] : []), ...painted, ...(box.bottom ? [blank] : [])];
}

/**
 * Row block that fits whatever width pi renders it at: every row is cut to the width with `…` (rows never wrap into
 * unindented fragments in a narrow terminal), except when `wrap` is set (an expanded call header, where the full
 * command should stay readable). Rules are drawn at the real width.
 */
export class Block implements Component {
	constructor(
		private content: Content = "",
		private wrap = false,
		private pad = 0,
		private box?: Box,
	) {}
	set(content: Content, wrap: boolean, pad = 0, box?: Box): void {
		this.content = content;
		this.wrap = wrap;
		this.pad = pad;
		this.box = box;
	}
	invalidate(): void {}
	render(width: number): string[] {
		const rows = this.rows(Math.max(1, width - 2 * this.pad));
		return paintRows(rows, width, this.pad, this.box);
	}
	private rows(w: number): string[] {
		const text = (typeof this.content === "function" ? this.content(w) : this.content).replace(/\t/g, "   ");
		if (!text.trim()) return [];
		return text.split("\n").flatMap((row) => {
			if (row.includes(RULE)) return [row.replace(RULE, "─".repeat(Math.max(1, w - INDENT)))];
			const fill = FILL_RE.exec(row);
			if (fill) {
				const cut = keepBackground(truncateToWidth(row.replace(FILL_RE, ""), w, "…"));
				return [`${cut}${fill[1]}${" ".repeat(Math.max(0, w - visibleWidth(cut)))}${fill[2] || SOFT_RESET}`];
			}
			if (!this.wrap) return [keepBackground(truncateToWidth(row, w, "…"))];
			// Wrapped continuations are indented so they stay under the row they belong to.
			const [first = "", ...rest] = wrapTextWithAnsi(row, Math.max(1, w - INDENT));
			return [first, ...rest.map((r) => `${" ".repeat(INDENT)}${r}`)].map(keepBackground);
		});
	}
}

/** Rows, or a function of the render width for rows that need it (hanging prefixes on wrapped lines). */
export type Content = string | ((width: number) => string);

/** One logical line as `prefix + text`; wrapped pieces repeat the prefix so they stay inside the gutter. */
export function prefixed(prefix: string, text: string, width: number, wrap: boolean): string[] {
	const room = Math.max(1, width - visibleWidth(prefix));
	if (!wrap) return [`${prefix}${truncateToWidth(text, room, "…")}`];
	return (text === "" ? [""] : wrapTextWithAnsi(text, room)).map((piece) => `${prefix}${piece}`);
}

/** How the tool boxes are painted (`tools.box`): `neutral` = pi's grey pending panel (red on errors), `theme` = pi's own panels, `none` = no box. */
export type BoxMode = "neutral" | "theme" | "none";
let boxMode: () => BoxMode = () => "neutral";
export const setBoxMode = (get: () => BoxMode): void => {
	boxMode = get;
};

/** Background of the tool box for a row state, or undefined when the mode draws none or the theme has no such background. */
export function boxBg(theme: Pick<Theme, "getBgAnsi">, state: { isPartial?: boolean; isError?: boolean }, mode: BoxMode = boxMode()): string | undefined {
	if (mode === "none") return undefined;
	let token: "toolErrorBg" | "toolSuccessBg" | "toolPendingBg" = "toolPendingBg";
	if (state.isError) token = "toolErrorBg";
	else if (mode === "theme" && !state.isPartial) token = "toolSuccessBg";
	try {
		const ansi = theme.getBgAnsi(token);
		return /\x1b\[48;/.test(ansi) ? ansi : undefined; // `ESC[49m` (a theme without that panel) draws nothing
	} catch {
		return undefined;
	}
}

type ShellCtx = { lastComponent: unknown; outputPad?: number; isPartial?: boolean; isError?: boolean };

/**
 * Reuse the previous Block instance when possible. Every lumen tool uses `renderShell: "self"`: pi paints nothing
 * behind the rows and leaves the horizontal `outputPad` to the renderer, so the Block applies it (and the box) itself.
 */
export function textOf(ctx: { lastComponent: unknown; outputPad?: number }, content: Content, wrap = false, box?: Box): Block {
	const t = ctx.lastComponent instanceof Block ? ctx.lastComponent : new Block();
	t.set(content, wrap, ctx.outputPad ?? 1, box);
	return t;
}

/** Row(s) of the call part of a tool: the box starts here (blank padded row on top). */
export const callOf = (theme: Pick<Theme, "getBgAnsi">, ctx: ShellCtx, content: Content, wrap = false): Block => {
	const bg = boxBg(theme, ctx);
	return textOf(ctx, content, wrap, bg ? { bg, top: true, bottom: false } : undefined);
};

/** Row(s) of the result part: the box ends here (blank padded row at the bottom). */
export const resultOf = (theme: Pick<Theme, "getBgAnsi">, ctx: ShellCtx, content: Content, wrap = false): Block => {
	const bg = boxBg(theme, ctx);
	return textOf(ctx, content, wrap, bg ? { bg, top: false, bottom: true } : undefined);
};

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

/** How many change rows are shown: `collapsedMax` by default, `expandedMax` (at least `collapsedMax`) once expanded. */
export const changeMax = (expanded: boolean, collapsedMax: number, expandedMax: number): number => (expanded ? Math.max(expandedMax, collapsedMax) : collapsedMax);

/**
 * Body shown by default (changes of `edit`/`write`): `collapsedMax` rows, or `expandedMax` once expanded.
 * `toggle` tells whether expanding reveals anything, so the hint only appears when it is useful.
 * `rows` may hold only the rows that can be shown (see `changeMax`) when `total` gives the real row count.
 */
export function changeBody(theme: Theme, rows: string[], expanded: boolean, collapsedMax: number, expandedMax: number, total = rows.length): { body: string; toggle: boolean } {
	const max = changeMax(expanded, collapsedMax, expandedMax);
	const shown = rows.slice(0, max);
	if (total > max) shown.push(theme.fg("muted", `… ${total - max} more lines`));
	return { body: shown.length ? framed(theme, shown) : "", toggle: total > collapsedMax };
}

export function plural(n: number, one: string, many = `${one}s`): string {
	return `${n} ${n === 1 ? one : many}`;
}
