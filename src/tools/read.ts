import { createReadToolDefinition, type ExtensionAPI, getLanguageFromPath, highlightCode, type ReadToolDetails, type Theme } from "@earendil-works/pi-coding-agent";
import type { BundledLanguage, BundledTheme } from "shiki";
import type { LumenConfig } from "../config.ts";
import { rowAt } from "./at.ts";
import { callLine, expandHint, framed, plural, resultLine, textOf } from "./format.ts";
import { builtinToolOptions } from "./options.ts";
import { cachedHighlight, languageFor, resolveTheme, warmHighlight } from "./shiki.ts";

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

interface ShikiPlan {
	theme: BundledTheme;
	lang: BundledLanguage;
}
const PLAN_KEY = "lumenShiki";
const PLAN_NONE = "none";

function plainPaint(theme: Theme, shown: string[], path: string): string[] {
	try {
		const lang = shown.reduce((n, l) => n + l.length + 1, 0) <= MAX_HL_CHARS ? getLanguageFromPath(path) : undefined;
		const painted = lang ? highlightCode(shown.join("\n"), lang) : shown.map((l) => theme.fg("toolOutput", l));
		return painted.length === shown.length ? painted : shown.map((l) => theme.fg("toolOutput", l));
	} catch {
		return shown.map((l) => theme.fg("toolOutput", l));
	}
}

/**
 * Expanded body: a full-width rule, syntax-highlighted lines with a dim line-number gutter, a closing rule.
 * `plan` (resolved Shiki theme + language) switches to Shiki once its result is cached; until then pi's own
 * highlighter paints, so the first frame is never blocked on loading a grammar.
 */
export function codeBody(theme: Theme, lines: string[], path: string, firstLine: number, max: number, hint: string | undefined, plan?: ShikiPlan, width?: number): string {
	if (!lines.length) return hint ? framed(theme, [theme.fg("muted", hint)], width) : "";
	const shown = lines.slice(0, max);
	const fromShiki = plan ? cachedHighlight(plan.theme, plan.lang, shown.join("\n")) : undefined;
	const painted = fromShiki?.length === shown.length ? fromShiki : plainPaint(theme, shown, path);
	const gutter = String(firstLine + shown.length - 1).length;
	const rows = painted.map((l, i) => `${theme.fg("dim", `${String(firstLine + i).padStart(gutter)} │`)} ${l}`);
	if (lines.length > shown.length) rows.push(theme.fg("muted", `… ${lines.length - shown.length} more lines`));
	if (hint) rows.push(theme.fg("muted", hint));
	return framed(theme, rows, width);
}

/** Resolve (once per row) which Shiki theme/language to use and warm the cache, then redraw the row. */
function planShiki(ctx: { state: unknown; invalidate: () => void }, path: string, code: string, themeName: string): ShikiPlan | undefined {
	const state = ctx.state as Record<string, unknown>;
	const known = state[PLAN_KEY];
	if (known === PLAN_NONE) return undefined;
	if (known && typeof known === "object") return known as ShikiPlan;
	if (known === "pending") return undefined;
	state[PLAN_KEY] = "pending";
	void (async () => {
		const lang = await languageFor(path, getLanguageFromPath(path));
		if (!lang) {
			state[PLAN_KEY] = PLAN_NONE;
			return;
		}
		const theme = await resolveTheme(themeName);
		await warmHighlight(theme, lang, code);
		state[PLAN_KEY] = { theme, lang } satisfies ShikiPlan;
		ctx.invalidate();
	})().catch(() => {
		state[PLAN_KEY] = PLAN_NONE;
	});
	return undefined;
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
			return textOf(ctx, callLine(theme, ctx, "Read", `${args.path}${range}`), ctx.expanded);
		},
		renderResult(result, { expanded, isPartial }, theme, ctx) {
			if (isPartial) return textOf(ctx, resultLine(theme, theme.fg("muted", "reading…")));
			const at = rowAt(getCfg, result.details);
			if (ctx.isError) return textOf(ctx, resultLine(theme, theme.fg("error", textOutput(result.content).split("\n")[0] ?? "error"), ctx.durationMs, at));
			// The image itself is drawn by pi below this row; only the summary is ours.
			if (result.content.some((c) => c.type === "image")) return textOf(ctx, resultLine(theme, theme.fg("success", "image"), ctx.durationMs, at));
			const { lines, notice } = splitRead(textOutput(result.content));
			const details = result.details as ReadToolDetails | undefined;
			let summary = theme.fg("success", plural(lines.length, "line"));
			if (details?.truncation?.truncated) summary += theme.fg("warning", ` (truncated from ${details.truncation.totalLines})`);
			const args = ctx.args as { path?: string; offset?: number } | undefined;
			const { previewLines: max, shiki, theme: shikiTheme } = getCfg().tools;
			const hint = lines.length ? expandHint(theme, ctx, expanded) : "";
			let body = "";
			if (expanded) {
				const plan = shiki ? planShiki(ctx, args?.path ?? "", lines.slice(0, max).join("\n"), shikiTheme) : undefined;
				body = codeBody(theme, lines, args?.path ?? "", args?.offset ?? 1, max, notice, plan);
			}
			return textOf(ctx, resultLine(theme, summary, ctx.durationMs, at) + hint + body);
		},
	});
}
