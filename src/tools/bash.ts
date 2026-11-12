import { type BashToolDetails, createBashToolDefinition, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LumenConfig } from "../config.ts";
import { callLine, expandHint, framedLines, oneLine, plural, prefixed, resultLine, textOf } from "./format.ts";
import { rowAt } from "./at.ts";
import { builtinToolOptions } from "./options.ts";

/** Lines of a multi-line command shown while collapsed. */
const MAX_CALL_LINES = 4;
const EXIT_RE = /Command exited with code (\d+)\s*$/;
const NOTICE_RE = /\n*\[Showing (?:last|lines)[^\]]*\]\s*$/;

/** Output lines, dropping blank edges, pi's `(no output)` placeholder, the truncation notice and the failure status line. */
export function outputLines(text: string): string[] {
	const body = text.replace(EXIT_RE, "").replace(NOTICE_RE, "").trim();
	return body && body !== "(no output)" ? body.split("\n") : [];
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
		execute: (id, params, signal, onUpdate, ctx) => createBashToolDefinition(ctx.cwd, builtinToolOptions(pi).bash).execute(id, params, signal, onUpdate, ctx),
		renderCall(args, theme, ctx) {
			const timeout = args.timeout ? `timeout ${args.timeout}s` : "";
			const cmdLines = String(args.command ?? "").split("\n");
			if (cmdLines.length === 1) return textOf(ctx, callLine(theme, ctx, "Bash", `${cmdLines[0]}${timeout ? ` · ${timeout}` : ""}`), ctx.expanded);
			// Multi-line script: the real lines under the header. Long lines wrap (expanded) or are cut (collapsed) behind the `│`, never under it.
			const max = ctx.expanded ? cmdLines.length : MAX_CALL_LINES;
			const gutter = `${theme.fg("dim", "  │")} `;
			const header = callLine(theme, ctx, "Bash", timeout || undefined);
			const hidden = cmdLines.length > max ? theme.fg("muted", `… +${cmdLines.length - max} lines`) : undefined;
			return textOf(
				ctx,
				(width) => [header, ...cmdLines.slice(0, max).flatMap((l) => prefixed(gutter, theme.fg("toolOutput", l), width, ctx.expanded)), ...(hidden ? [`${gutter}${hidden}`] : [])].join("\n"),
				false,
			);
		},
		renderResult(result, { expanded, isPartial }, theme, ctx) {
			const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
			const lines = outputLines(text);
			if (isPartial) return textOf(ctx, resultLine(theme, theme.fg("muted", `running · ${plural(lines.length, "line")}`)));
			const code = exitCodeOf(text, ctx.isError);
			const details = result.details as BashToolDetails | undefined;
			const at = rowAt(getCfg, result.details);
			let summary = code === 0 ? theme.fg("success", "exit 0") : theme.fg("error", `exit ${code}`);
			summary += theme.fg("dim", ` · ${lines.length ? plural(lines.length, "line") : "no output"}`);
			const last = lines[lines.length - 1];
			if (code !== 0 && !expanded && last) summary += theme.fg("muted", ` · ${oneLine(last, 60)}`);
			if (details?.truncation?.truncated) summary += theme.fg("warning", " · truncated");
			const hint = lines.length ? expandHint(theme, ctx, expanded) : "";
			const body = expanded ? framedLines(theme, lines, getCfg().tools.previewLines) : "";
			return textOf(ctx, resultLine(theme, summary, ctx.durationMs, at) + hint + body);
		},
	});
}
