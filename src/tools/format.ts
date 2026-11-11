/**
 * Compact tool rows: `● Name (arg)` and `  └ result · duration`.
 * Inspired by heyhuynhgiabuu/pi-pretty v0.10.0 (MIT): renderers only, no execution changes.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { formatToolDuration } from "../time.ts";

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

/** Reuse the previous Text instance when possible. */
export function textOf(ctx: { lastComponent: unknown }, content: string): Text {
	const t = ctx.lastComponent instanceof Text ? ctx.lastComponent : new Text("", 0, 0);
	t.setText(content);
	return t;
}

export function oneLine(s: string, max = MAX_ARG): string {
	const flat = s.replace(/\s*\n\s*/g, " ⏎ ").trim();
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

/** `  └ summary · 0.02s`; `summary` is already styled. */
export function resultLine(theme: Theme, summary: string, durationMs?: number): string {
	const dur = durationMs === undefined ? "" : theme.fg("dim", ` · ${formatToolDuration(durationMs)}`);
	return `${theme.fg("dim", "  └")} ${summary}${dur}`;
}

/** Dim, indented preview of the first `max` lines with a native expand hint when something is hidden. */
export function previewLines(theme: Theme, lines: string[], max: number, expanded: boolean, ctx: Pick<RowContext, "keyHint">): string {
	const shown = expanded ? lines.slice(0, max) : [];
	let out = shown.map((l) => `\n    ${theme.fg("toolOutput", l)}`).join("");
	const hidden = lines.length - shown.length;
	if (hidden > 0) {
		out += `\n    ${theme.fg("muted", expanded ? `… ${hidden} more lines` : `(${ctx.keyHint("app.tools.expand", "to expand")})`)}`;
	}
	return out;
}

export function plural(n: number, one: string, many = `${one}s`): string {
	return `${n} ${n === 1 ? one : many}`;
}
