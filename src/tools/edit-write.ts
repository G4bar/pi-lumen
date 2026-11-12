import { createEditToolDefinition, createWriteToolDefinition, type EditToolDetails, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LumenConfig } from "../config.ts";
import { rowAt } from "./at.ts";
import { diffRows, writeRows } from "./changes.ts";
import { callLine, changeBody, changeMax, expandHint, plural, resultLine, textOf } from "./format.ts";
import { shikiPainter, shikiThemeName } from "./highlight.ts";

/** Count added/removed lines in pi's display diff (`+N text` / `-N text`). */
export function diffStats(diff: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) added++;
		else if (line.startsWith("-") && !line.startsWith("---")) removed++;
	}
	return { added, removed };
}

const firstLine = (content: ReadonlyArray<{ type: string; text?: string }>): string => {
	const t = content.find((c) => c.type === "text")?.text ?? "error";
	return t.split("\n")[0] ?? "error";
};

export function registerEditWrite(pi: ExtensionAPI, getCfg: () => LumenConfig): void {
	const edit = createEditToolDefinition(process.cwd());
	pi.registerTool({
		...edit,
		// The built-in edit renders its own shell; compact rows use the default themed box instead.
		renderShell: "default",
		execute: (id, params, signal, onUpdate, ctx) => createEditToolDefinition(ctx.cwd).execute(id, params, signal, onUpdate, ctx),
		renderCall(args, theme, ctx) {
			const n = Array.isArray(args.edits) ? args.edits.length : 0;
			return textOf(ctx, callLine(theme, ctx, "Edit", `${args.path ?? ""}${n > 1 ? ` · ${n} edits` : ""}`), ctx.expanded);
		},
		renderResult(result, { expanded, isPartial }, theme, ctx) {
			if (isPartial) return textOf(ctx, resultLine(theme, theme.fg("muted", "editing…")));
			const at = rowAt(getCfg, result.details);
			if (ctx.isError) return textOf(ctx, resultLine(theme, theme.fg("error", firstLine(result.content)), ctx.durationMs, at));
			const details = result.details as EditToolDetails | undefined;
			if (!details?.diff) return textOf(ctx, resultLine(theme, theme.fg("success", "applied"), ctx.durationMs, at));
			const { added, removed } = diffStats(details.diff);
			const summary = `${theme.fg("success", `+${added}`)} ${theme.fg("error", `-${removed}`)}`;
			const { previewLines, changeLines, shiki, theme: shikiTheme } = getCfg().tools;
			const path = String((ctx.args as { path?: unknown } | undefined)?.path ?? "");
			const { rows, total } = diffRows(theme, details.diff, path, changeMax(expanded, changeLines, previewLines), shikiPainter(ctx, path, shikiThemeName(shikiTheme, theme), shiki));
			const { body, toggle } = changeBody(theme, rows, expanded, changeLines, previewLines, total);
			return textOf(ctx, resultLine(theme, summary, ctx.durationMs, at) + (toggle ? expandHint(theme, ctx, expanded) : "") + body);
		},
	});

	const write = createWriteToolDefinition(process.cwd());
	pi.registerTool({
		...write,
		renderShell: "default",
		execute: (id, params, signal, onUpdate, ctx) => createWriteToolDefinition(ctx.cwd).execute(id, params, signal, onUpdate, ctx),
		renderCall(args, theme, ctx) {
			return textOf(ctx, callLine(theme, ctx, "Write", args.path ?? ""), ctx.expanded);
		},
		renderResult(result, { expanded, isPartial }, theme, ctx) {
			if (isPartial) return textOf(ctx, resultLine(theme, theme.fg("muted", "writing…")));
			const at = rowAt(getCfg, result.details);
			if (ctx.isError) return textOf(ctx, resultLine(theme, theme.fg("error", firstLine(result.content)), ctx.durationMs, at));
			const content = typeof ctx.args?.content === "string" ? ctx.args.content : "";
			const lines = content ? content.replace(/\n$/, "").split("\n") : [];
			const { previewLines, changeLines, shiki, theme: shikiTheme } = getCfg().tools;
			const path = String((ctx.args as { path?: unknown } | undefined)?.path ?? "");
			const rows = writeRows(theme, lines, path, changeMax(expanded, changeLines, previewLines), shikiPainter(ctx, path, shikiThemeName(shikiTheme, theme), shiki));
			const { body, toggle } = changeBody(theme, rows, expanded, changeLines, previewLines, lines.length);
			return textOf(ctx, resultLine(theme, theme.fg("success", `wrote ${plural(lines.length, "line")}`), ctx.durationMs, at) + (toggle ? expandHint(theme, ctx, expanded) : "") + body);
		},
	});
}
