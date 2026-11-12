import { createReadToolDefinition, type ExtensionAPI, getLanguageFromPath, highlightCode, type ReadToolDetails, type Theme } from "@earendil-works/pi-coding-agent";
import type { LumenConfig } from "../config.ts";
import { callLine, plural, previewLines, resultLine, textOf } from "./format.ts";
import { builtinToolOptions } from "./options.ts";

/** Skip syntax highlighting above this many characters (keeps rendering instant). */
const MAX_HL_CHARS = 80_000;
const NOTICE_RE = /\n*\[(?:Showing lines|\d+ more lines)[^\]]*\]\s*$/;

function textOutput(content: ReadonlyArray<{ type: string; text?: string }>): string {
	return content.map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("\n");
}

/** File lines (no trailing blank) and pi's continuation notice (`[N more lines… Use offset=…]`), if any. */
export function splitRead(text: string): { lines: string[]; notice: string | undefined } {
	const notice = NOTICE_RE.exec(text)?.[0].trim();
	const body = (notice ? text.replace(NOTICE_RE, "") : text).replace(/\n$/, "");
	return { lines: body.length ? body.split("\n") : [], notice };
}

/** Expanded body: syntax-highlighted lines (language from the path, via pi's own highlighter) with a line-number gutter. */
export function codeBody(theme: Theme, lines: string[], path: string, firstLine: number, max: number, hint: string | undefined): string {
	const shown = lines.slice(0, max);
	const chars = shown.reduce((n, l) => n + l.length + 1, 0);
	let painted: string[];
	try {
		const lang = chars <= MAX_HL_CHARS ? getLanguageFromPath(path) : undefined;
		painted = lang ? highlightCode(shown.join("\n"), lang) : shown.map((l) => theme.fg("toolOutput", l));
		if (painted.length !== shown.length) painted = shown.map((l) => theme.fg("toolOutput", l));
	} catch {
		painted = shown.map((l) => theme.fg("toolOutput", l));
	}
	const width = String(firstLine + shown.length - 1).length;
	let out = painted.map((l, i) => `\n  ${theme.fg("dim", `${String(firstLine + i).padStart(width)} │`)} ${l}`).join("");
	if (lines.length > shown.length) out += `\n    ${theme.fg("muted", `… ${lines.length - shown.length} more lines`)}`;
	if (hint) out += `\n    ${theme.fg("muted", hint)}`;
	return out;
}

export function registerRead(pi: ExtensionAPI, getCfg: () => LumenConfig): void {
	const base = createReadToolDefinition(process.cwd());
	pi.registerTool({
		...base,
		renderShell: "default",
		execute: (id, params, signal, onUpdate, ctx) => createReadToolDefinition(ctx.cwd, builtinToolOptions(pi).read).execute(id, params, signal, onUpdate, ctx),
		renderCall(args, theme, ctx) {
			let range = "";
			if (args.offset || args.limit) range = ` :${args.offset ?? 1}${args.limit ? `+${args.limit}` : ""}`;
			return textOf(ctx, callLine(theme, ctx, "Read", `${args.path}${range}`));
		},
		renderResult(result, { expanded, isPartial }, theme, ctx) {
			if (isPartial) return textOf(ctx, resultLine(theme, theme.fg("muted", "reading…")));
			if (ctx.isError) return textOf(ctx, resultLine(theme, theme.fg("error", textOutput(result.content).split("\n")[0] ?? "error"), ctx.durationMs));
			// The image itself is drawn by pi below this row; only the summary is ours.
			if (result.content.some((c) => c.type === "image")) return textOf(ctx, resultLine(theme, theme.fg("success", "image"), ctx.durationMs));
			const { lines, notice } = splitRead(textOutput(result.content));
			const details = result.details as ReadToolDetails | undefined;
			let summary = theme.fg("success", plural(lines.length, "line"));
			if (details?.truncation?.truncated) summary += theme.fg("warning", ` (truncated from ${details.truncation.totalLines})`);
			const args = ctx.args as { path?: string; offset?: number } | undefined;
			const max = getCfg().tools.previewLines;
			let body: string;
			if (expanded) body = codeBody(theme, lines, args?.path ?? "", args?.offset ?? 1, max, notice);
			else body = previewLines(theme, lines, max, false, ctx);
			return textOf(ctx, resultLine(theme, summary, ctx.durationMs) + body);
		},
	});
}
