/**
 * Shared code painting for `read`, `edit` and `write` rows.
 *
 * Two layers: pi's own (synchronous) highlighter paints the first frame; once the Shiki grammar for the file
 * is loaded (lazily, per row) the same rows are redrawn with Shiki. Callers never block on loading.
 */
import { getLanguageFromPath, highlightCode, type Theme } from "@earendil-works/pi-coding-agent";
import type { BundledLanguage, BundledTheme } from "shiki";
import { cachedHighlight, DEFAULT_SHIKI_THEME, languageFor, resolveTheme, warmHighlight } from "./shiki.ts";

/** Skip pi's syntax highlighting above this many characters (keeps rendering instant). */
const MAX_HL_CHARS = 80_000;

/** Highlighted lines for `code` if Shiki already has them (a miss starts the work and redraws the row later). */
export type ShikiPaint = (code: string) => string[] | undefined;

/** pi's highlighter, or the plain tool-output color when the language is unknown or the text is huge. */
export function plainPaint(theme: Theme, shown: string[], path: string): string[] {
	const plain = () => shown.map((l) => theme.fg("toolOutput", l));
	try {
		const lang = shown.reduce((n, l) => n + l.length + 1, 0) <= MAX_HL_CHARS ? getLanguageFromPath(path) : undefined;
		const painted = lang ? highlightCode(shown.join("\n"), lang) : plain();
		return painted.length === shown.length ? painted : plain();
	} catch {
		return plain();
	}
}

/** Shiki result if available, else pi's painter. One painted string per input line. */
export function paintLines(theme: Theme, lines: string[], path: string, shiki?: ShikiPaint): string[] {
	const fromShiki = shiki?.(lines.join("\n"));
	return fromShiki?.length === lines.length ? fromShiki : plainPaint(theme, lines, path);
}

/**
 * Shiki theme to use: `tools.theme` as written, or for `"auto"` a light one on pi themes with a light tool
 * background (judged by `toolSuccessBg`'s brightness) and the dark default otherwise.
 */
export function shikiThemeName(name: string, theme: Theme): string {
	if (name !== "auto") return name;
	try {
		const m = /48;2;(\d+);(\d+);(\d+)/.exec(theme.getBgAnsi("toolSuccessBg"));
		if (m && 0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3]) >= 140) return "github-light";
	} catch {
		/* theme without color lookup */
	}
	return DEFAULT_SHIKI_THEME;
}

interface Plan {
	theme: BundledTheme;
	lang: BundledLanguage;
}
const PLAN_KEY = "lumenShikiPlan";
const ASKED_KEY = "lumenShikiAsked";
const NONE = "none";

/**
 * Per-row Shiki painter: resolves the language/theme once (kept in the row's `state`), warms each distinct code
 * block at most once and asks pi to redraw the row when the result lands. `enabled=false` never loads anything.
 */
export function shikiPainter(ctx: { state: unknown; invalidate: () => void }, path: string, themeName: string, enabled: boolean): ShikiPaint {
	const state = ctx.state as Record<string, unknown>;
	const asked = (state[ASKED_KEY] ??= new Set<string>()) as Set<string>;
	const redraw = () => ctx.invalidate();
	return (code) => {
		if (!enabled || !code) return undefined;
		const plan = state[PLAN_KEY];
		if (plan === NONE) return undefined;
		if (plan && typeof plan === "object") {
			const p = plan as Plan;
			const hit = cachedHighlight(p.theme, p.lang, code);
			if (hit) return hit;
			if (!asked.has(code)) {
				asked.add(code);
				void warmHighlight(p.theme, p.lang, code).then(redraw, () => undefined);
			}
			return undefined;
		}
		if (plan === "pending") return undefined; // other blocks are warmed on the redraw that follows
		state[PLAN_KEY] = "pending";
		asked.add(code);
		void (async () => {
			const lang = await languageFor(path, getLanguageFromPath(path));
			if (!lang) {
				state[PLAN_KEY] = NONE;
				return;
			}
			const theme = await resolveTheme(themeName);
			await warmHighlight(theme, lang, code);
			state[PLAN_KEY] = { theme, lang } satisfies Plan;
			redraw();
		})().catch(() => {
			state[PLAN_KEY] = NONE;
		});
		return undefined;
	};
}
