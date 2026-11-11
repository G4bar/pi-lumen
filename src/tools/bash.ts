import { type BashToolDetails, createBashToolDefinition, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LumenConfig } from "../config.ts";
import { callLine, oneLine, plural, previewLines, resultLine, textOf } from "./format.ts";

const EXIT_RE = /Command exited with code (\d+)\s*$/;

/** Output lines, dropping blank edges and the trailing status line added on failure. */
export function outputLines(text: string): string[] {
	const lines = text.replace(EXIT_RE, "").trim();
	return lines ? lines.split("\n") : [];
}

export function exitCodeOf(text: string, isError: boolean): number {
	const m = EXIT_RE.exec(text.trim());
	if (m) return Number(m[1]);
	return isError ? 1 : 0;
}

export function registerBash(pi: ExtensionAPI, getCfg: () => LumenConfig): void {
	const base = createBashToolDefinition(process.cwd());
	pi.registerTool({
		...base,
		renderShell: "default",
		execute: (id, params, signal, onUpdate, ctx) => createBashToolDefinition(ctx.cwd).execute(id, params, signal, onUpdate, ctx),
		renderCall(args, theme, ctx) {
			const suffix = args.timeout ? ` · timeout ${args.timeout}s` : "";
			return textOf(ctx, callLine(theme, ctx, "Bash", `${args.command ?? ""}${suffix}`));
		},
		renderResult(result, { expanded, isPartial }, theme, ctx) {
			const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
			const lines = outputLines(text);
			if (isPartial) return textOf(ctx, resultLine(theme, theme.fg("muted", `running · ${plural(lines.length, "line")}`)));
			const code = exitCodeOf(text, ctx.isError);
			const details = result.details as BashToolDetails | undefined;
			let summary = code === 0 ? theme.fg("success", "exit 0") : theme.fg("error", `exit ${code}`);
			summary += theme.fg("dim", ` · ${plural(lines.length, "line")}`);
			const last = lines[lines.length - 1];
			if (code !== 0 && !expanded && last) summary += theme.fg("muted", ` · ${oneLine(last, 60)}`);
			if (details?.truncation?.truncated) summary += theme.fg("warning", " · truncated");
			return textOf(ctx, resultLine(theme, summary, ctx.durationMs) + previewLines(theme, lines, getCfg().tools.previewLines, expanded, ctx));
		},
	});
}
