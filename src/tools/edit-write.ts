import { createEditToolDefinition, createWriteToolDefinition, type EditToolDetails, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LumenConfig } from "../config.ts";
import { rowAt } from "./at.ts";
import { bgTints, diffRows, writeRows } from "./changes.ts";
import { boxBg, callLine, callOf, changeBody, changeMax, expandHint, plural, resultLine, resultOf } from "./format.ts";
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
		// We paint the tool box ourselves (`tools.box`): pi's green success panel hides the added/removed row tints,
		// a neutral one does not. Block applies `outputPad` and the background.
		renderShell: "self",
		execute: (id, params, signal, onUpdate, ctx) => createEditToolDefinition(ctx.cwd).execute(id, params, signal, onUpdate, ctx),
		renderCall(args, theme, ctx) {
			const n = Array.isArray(args.edits) ? args.edits.length : 0;
			return callOf(theme, ctx, callLine(theme, ctx, "Edit", `${args.path ?? ""}${n > 1 ? ` · ${n} edits` : ""}`), ctx.expanded);
		},
		renderResult(result, { expanded, isPartial }, theme, ctx) {
			if (isPartial) return resultOf(theme, ctx, resultLine(theme, theme.fg("muted", "editing…")));
			const at = rowAt(getCfg, result.details);
			if (ctx.isError) return resultOf(theme, ctx, resultLine(theme, theme.fg("error", firstLine(result.content)), ctx.durationMs, at));
			const details = result.details as EditToolDetails | undefined;
			if (!details?.diff) return resultOf(theme, ctx, resultLine(theme, theme.fg("success", "applied"), ctx.durationMs, at));
			const { added, removed } = diffStats(details.diff);
			const summary = `${theme.fg("success", `+${added}`)} ${theme.fg("error", `-${removed}`)}`;
			const { previewLines, changeLines, shiki, theme: shikiTheme } = getCfg().tools;
			const path = String((ctx.args as { path?: unknown } | undefined)?.path ?? "");
			const { rows, total } = diffRows(theme, details.diff, path, changeMax(expanded, changeLines, previewLines), shikiPainter(ctx, path, shikiThemeName(shikiTheme, theme), shiki), bgTints(theme, boxBg(theme, ctx)));
			const { body, toggle } = changeBody(theme, rows, expanded, changeLines, previewLines, total);
			return resultOf(theme, ctx, resultLine(theme, summary, ctx.durationMs, at) + (toggle ? expandHint(theme, ctx, expanded) : "") + body);
		},
	});

	const write = createWriteToolDefinition(process.cwd());
	pi.registerTool({
		...write,
		renderShell: "self",
		execute: (id, params, signal, onUpdate, ctx) => createWriteToolDefinition(ctx.cwd).execute(id, params, signal, onUpdate, ctx),
		renderCall(args, theme, ctx) {
			return callOf(theme, ctx, callLine(theme, ctx, "Write", args.path ?? ""), ctx.expanded);
		},
		renderResult(result, { expanded, isPartial }, theme, ctx) {
			if (isPartial) return resultOf(theme, ctx, resultLine(theme, theme.fg("muted", "writing…")));
			const at = rowAt(getCfg, result.details);
			if (ctx.isError) return resultOf(theme, ctx, resultLine(theme, theme.fg("error", firstLine(result.content)), ctx.durationMs, at));
			const content = typeof ctx.args?.content === "string" ? ctx.args.content : "";
			const lines = content ? content.replace(/\n$/, "").split("\n") : [];
			const { previewLines, changeLines, shiki, theme: shikiTheme } = getCfg().tools;
			const path = String((ctx.args as { path?: unknown } | undefined)?.path ?? "");
			const rows = writeRows(theme, lines, path, changeMax(expanded, changeLines, previewLines), shikiPainter(ctx, path, shikiThemeName(shikiTheme, theme), shiki));
			const { body, toggle } = changeBody(theme, rows, expanded, changeLines, previewLines, lines.length);
			return resultOf(theme, ctx, resultLine(theme, theme.fg("success", `wrote ${plural(lines.length, "line")}`), ctx.durationMs, at) + (toggle ? expandHint(theme, ctx, expanded) : "") + body);
		},
	});
}
