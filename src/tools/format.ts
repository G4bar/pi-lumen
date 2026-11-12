/**
 * Compact tool rows: `● Name (arg)` and `  └ result · duration`.
 * Inspired by heyhuynhgiabuu/pi-pretty v0.10.0 (MIT): renderers only, no execution changes.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
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

/** `  └ summary · 0.02s · 14:32:07`; `summary` is already styled, `at` is the start time (ms). */
export function resultLine(theme: Theme, summary: string, durationMs?: number, at?: number): string {
	const dur = durationMs === undefined ? "" : theme.fg("dim", ` · ${formatToolDuration(durationMs)}`);
	const when = at === undefined ? "" : theme.fg("dim", ` · ${formatAt(at)}`);
	return `${theme.fg("dim", "  └")} ${summary}${dur}${when}`;
}

/** Width of the full-width rules (pi gives renderers no width; clamp like the rest of the UI). */
export function ruleWidth(): number {
	return Math.max(10, Math.min(process.stdout.columns || 100, 200) - 2);
}

/** ` · ctrl+o to expand` / `to collapse`, appended to the result row so the body needs no hint line of its own. */
export function expandHint(theme: Theme, ctx: Pick<RowContext, "keyHint">, expanded: boolean): string {
	return theme.fg("dim", ` · ${ctx.keyHint("app.tools.expand", expanded ? "to collapse" : "to expand")}`);
}

/** Expanded body: blank line, full-width dim rule, `rows` indented to the `└`, closing rule. `rows` are already styled. */
export function framed(theme: Theme, rows: string[], width = ruleWidth()): string {
	const rule = `\n  ${theme.fg("dim", "─".repeat(width))}`;
	return `\n${rule}${rows.map((r) => `\n  ${r}`).join("")}${rule}`;
}

/** The first `max` lines as framed rows, with a `… N more lines` marker when cut. */
export function framedLines(theme: Theme, lines: string[], max: number, paint: (line: string) => string = (l) => theme.fg("toolOutput", l), width = ruleWidth()): string {
	const rows = lines.slice(0, max).map(paint);
	if (lines.length > max) rows.push(theme.fg("muted", `… ${lines.length - max} more lines`));
	return rows.length ? framed(theme, rows, width) : "";
}

export function plural(n: number, one: string, many = `${one}s`): string {
	return `${n} ${n === 1 ? one : many}`;
}
