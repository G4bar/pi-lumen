import { createEditToolDefinition, createWriteToolDefinition, type EditToolDetails, type ExtensionAPI, renderDiff } from "@earendil-works/pi-coding-agent";
import type { LumenConfig } from "../config.ts";
import { rowAt } from "./at.ts";
import { callLine, plural, resultLine, textOf } from "./format.ts";

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
			return textOf(ctx, callLine(theme, ctx, "Edit", `${args.path ?? ""}${n > 1 ? ` · ${n} edits` : ""}`));
		},
		renderResult(result, { expanded, isPartial }, theme, ctx) {
			if (isPartial) return textOf(ctx, resultLine(theme, theme.fg("muted", "editing…")));
			const at = rowAt(getCfg, result.details);
			if (ctx.isError) return textOf(ctx, resultLine(theme, theme.fg("error", firstLine(result.content)), ctx.durationMs, at));
			const details = result.details as EditToolDetails | undefined;
			if (!details?.diff) return textOf(ctx, resultLine(theme, theme.fg("success", "applied"), ctx.durationMs, at));
			const { added, removed } = diffStats(details.diff);
			const summary = `${theme.fg("success", `+${added}`)} ${theme.fg("error", `-${removed}`)}`;
			let body = "";
			if (expanded) {
				const lines = renderDiff(details.diff).split("\n");
				const max = getCfg().tools.previewLines;
				body = lines.slice(0, max).map((l) => `\n    ${l}`).join("");
				if (lines.length > max) body += `\n    ${theme.fg("muted", `… ${lines.length - max} more lines`)}`;
			} else {
				body = `\n    ${theme.fg("muted", `(${ctx.keyHint("app.tools.expand", "to expand")})`)}`;
			}
			return textOf(ctx, resultLine(theme, summary, ctx.durationMs, at) + body);
		},
	});

	const write = createWriteToolDefinition(process.cwd());
	pi.registerTool({
		...write,
		renderShell: "default",
		execute: (id, params, signal, onUpdate, ctx) => createWriteToolDefinition(ctx.cwd).execute(id, params, signal, onUpdate, ctx),
		renderCall(args, theme, ctx) {
			return textOf(ctx, callLine(theme, ctx, "Write", args.path ?? ""));
		},
		renderResult(result, { isPartial }, theme, ctx) {
			if (isPartial) return textOf(ctx, resultLine(theme, theme.fg("muted", "writing…")));
			const at = rowAt(getCfg, result.details);
			if (ctx.isError) return textOf(ctx, resultLine(theme, theme.fg("error", firstLine(result.content)), ctx.durationMs, at));
			const content = typeof ctx.args?.content === "string" ? ctx.args.content : "";
			const n = content ? content.replace(/\n$/, "").split("\n").length : 0;
			return textOf(ctx, resultLine(theme, theme.fg("success", `wrote ${plural(n, "line")}`), ctx.durationMs, at));
		},
	});
}
