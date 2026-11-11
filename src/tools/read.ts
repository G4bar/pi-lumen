import { type ExtensionAPI, createReadToolDefinition, type ReadToolDetails } from "@earendil-works/pi-coding-agent";
import type { LumenConfig } from "../config.ts";
import { callLine, plural, previewLines, resultLine, textOf } from "./format.ts";

function textOutput(content: ReadonlyArray<{ type: string; text?: string }>): string {
	return content.map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("\n");
}

export function registerRead(pi: ExtensionAPI, getCfg: () => LumenConfig): void {
	const base = createReadToolDefinition(process.cwd());
	pi.registerTool({
		...base,
		renderShell: "default",
		execute: (id, params, signal, onUpdate, ctx) => createReadToolDefinition(ctx.cwd).execute(id, params, signal, onUpdate, ctx),
		renderCall(args, theme, ctx) {
			let range = "";
			if (args.offset || args.limit) range = ` :${args.offset ?? 1}${args.limit ? `+${args.limit}` : ""}`;
			return textOf(ctx, callLine(theme, ctx, "Read", `${args.path}${range}`));
		},
		renderResult(result, { expanded, isPartial }, theme, ctx) {
			if (isPartial) return textOf(ctx, resultLine(theme, theme.fg("muted", "reading…")));
			const first = result.content[0];
			if (ctx.isError) return textOf(ctx, resultLine(theme, theme.fg("error", textOutput(result.content).split("\n")[0] ?? "error"), ctx.durationMs));
			if (first?.type === "image") return textOf(ctx, resultLine(theme, theme.fg("success", "image"), ctx.durationMs));
			const text = textOutput(result.content);
			const lines = text.length ? text.split("\n") : [];
			const details = result.details as ReadToolDetails | undefined;
			let summary = theme.fg("success", plural(lines.length, "line"));
			if (details?.truncation?.truncated) summary += theme.fg("warning", ` (truncated from ${details.truncation.totalLines})`);
			return textOf(ctx, resultLine(theme, summary, ctx.durationMs) + previewLines(theme, lines, getCfg().tools.previewLines, expanded, ctx));
		},
	});
}
