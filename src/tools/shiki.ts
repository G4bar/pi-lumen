/**
 * Optional Shiki highlighting for the expanded `read` body.
 *
 * Shiki is imported lazily and one language grammar at a time, so it costs nothing until a file is expanded.
 * If the package is missing or a grammar fails, callers keep pi's own highlighter. The token → ANSI conversion
 * and the low-contrast guard are mine; the idea (and the `github-dark` default) comes from
 * heyhuynhgiabuu/pi-pretty v0.10.0 (src/render.ts), MIT.
 */

export const DEFAULT_SHIKI_THEME: BundledTheme = "github-dark";
/** Skip highlighting above this many characters. */
export const MAX_SHIKI_CHARS = 120_000;
const CACHE_LIMIT = 24;
const MUTED_FG = "38;2;139;148;158";

import type { BundledLanguage, BundledTheme } from "shiki";

type ShikiModule = typeof import("shiki");
type Hl = Awaited<ReturnType<ShikiModule["createHighlighter"]>>;
interface Token {
	content: string;
	color?: string | undefined;
	fontStyle?: number | undefined;
}

let mod: Promise<ShikiModule | undefined> | undefined;
let hl: Promise<Hl | undefined> | undefined;
const cache = new Map<string, string[]>();
const failed = new Set<string>();
const pending = new Map<string, Promise<void>>();

const loadModule = (): Promise<ShikiModule | undefined> => {
	mod ??= import("shiki").catch(() => undefined);
	return mod;
};

/** Relative luminance below which a foreground would vanish on a dark terminal. */
export function isLowContrast(r: number, g: number, b: number): boolean {
	return 0.2126 * r + 0.7152 * g + 0.0722 * b < 72;
}

/** `#rrggbb` (or `#rrggbbaa`) → SGR parameters, lifting near-black foregrounds to a muted grey. */
export function fgParams(color: string | undefined): string | undefined {
	const m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(color ?? "");
	if (!m?.[1]) return undefined;
	const n = Number.parseInt(m[1], 16);
	const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
	return isLowContrast(r, g, b) ? MUTED_FG : `38;2;${r};${g};${b}`;
}

/** One painted line per token line; only foreground/bold/italic/underline are emitted, never a background. */
export function tokensToAnsi(lines: Token[][]): string[] {
	return lines.map((tokens) =>
		tokens
			.map((t) => {
				const codes: string[] = [];
				const fg = fgParams(t.color);
				if (fg) codes.push(fg);
				const fs = t.fontStyle ?? 0;
				if (fs & 1) codes.push("3");
				if (fs & 2) codes.push("1");
				if (fs & 4) codes.push("4");
				return codes.length ? `\x1b[${codes.join(";")}m${t.content}\x1b[0m` : t.content;
			})
			.join(""),
	);
}

/** Shiki language id for a path: its own extension table first (covers far more than pi's), then `fallback`. */
export async function languageFor(path: string, fallback: string | undefined): Promise<BundledLanguage | undefined> {
	const m = await loadModule();
	if (!m) return undefined;
	const base = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
	const ext = base.includes(".") ? base.split(".").pop() : base;
	const known = (k: string | undefined): k is BundledLanguage => k !== undefined && k in m.bundledLanguages;
	return [ext, fallback].find(known);
}

export async function resolveTheme(name: string): Promise<BundledTheme> {
	const m = await loadModule();
	const known = (k: string): k is BundledTheme => m !== undefined && k in m.bundledThemes;
	return known(name) ? name : DEFAULT_SHIKI_THEME;
}

const key = (theme: string, lang: string, code: string): string => `${theme}\0${lang}\0${code}`;

/** Cached result, if the code was already highlighted. Never blocks. */
export function cachedHighlight(theme: BundledTheme, lang: BundledLanguage, code: string): string[] | undefined {
	const k = key(theme, lang, code);
	const hit = cache.get(k);
	if (hit) {
		cache.delete(k);
		cache.set(k, hit);
	}
	return hit;
}

/** Start highlighting in the background; resolves when the result is cached (or highlighting is impossible). */
export function warmHighlight(theme: BundledTheme, lang: BundledLanguage, code: string): Promise<void> {
	const k = key(theme, lang, code);
	if (cache.has(k) || failed.has(k) || code.length > MAX_SHIKI_CHARS) return Promise.resolve();
	const running = pending.get(k);
	if (running) return running;
	const p = (async () => {
		try {
			const m = await loadModule();
			if (!m) return void failed.add(k);
			hl ??= m.createHighlighter({ themes: [theme], langs: [] });
			const h = await hl;
			if (!h) return void failed.add(k);
			await h.loadTheme(theme);
			await h.loadLanguage(lang);
			cache.set(k, tokensToAnsi(h.codeToTokensBase(code, { lang, theme })));
			while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
		} catch {
			failed.add(k);
		} finally {
			pending.delete(k);
		}
	})();
	pending.set(k, p);
	return p;
}
