/**
 * Rows for `edit` and `write`: line-number gutter, a sign slot (`+` / `-` / `│`) and syntax-highlighted code.
 * Same gutter as `read` (`  N │ code`) so the three tools line up.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { fillRow } from "./format.ts";
import { paintLines, type ShikiPaint } from "./highlight.ts";

interface DiffEntry {
	kind: "add" | "del" | "ctx" | "gap";
	/** Line number (new file for `add`, old file for `del`/`ctx`). */
	no: number;
	text: string;
}

// pi's display diff: `+N text`, `-N text`, ` N text` (numbers left-padded) and ` <pad> ...` for skipped context.
const ENTRY_RE = /^([+\- ])( *\d+) (.*)$/;
const GAP_RE = /^ +\.\.\.$/;

/** Parse the display diff pi stores in the edit result details. */
export function parseDiff(diff: string): DiffEntry[] {
	const out: DiffEntry[] = [];
	for (const line of diff.split("\n")) {
		const m = ENTRY_RE.exec(line);
		if (m?.[1] !== undefined && m[2] !== undefined) {
			out.push({ kind: m[1] === "+" ? "add" : m[1] === "-" ? "del" : "ctx", no: Number(m[2]), text: m[3] ?? "" });
		} else if (GAP_RE.test(line)) {
			out.push({ kind: "gap", no: 0, text: "" });
		}
	}
	return out;
}

const SIGN = { add: "+", del: "-", ctx: "│", gap: "⋯" } as const;
type Color = Parameters<Theme["fg"]>[0];
const COLOR: Record<DiffEntry["kind"], Color> = { add: "toolDiffAdded", del: "toolDiffRemoved", ctx: "dim", gap: "dim" };

/** Row backgrounds of one change kind: `base` for the whole row, `strong` for the words that changed. */
export interface Tint {
	base: string;
	strong: string;
}
export interface Tints {
	add: Tint;
	del: Tint;
}

const bgOpen = (c: Rgb): string => `\x1b[48;2;${Math.round(c[0])};${Math.round(c[1])};${Math.round(c[2])}m`;
type Rgb = [number, number, number];
const rgbOf = (ansi: string, plane: 38 | 48): Rgb | undefined => {
	const m = new RegExp(`${plane};2;(\\d+);(\\d+);(\\d+)`).exec(ansi);
	return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
};
const mix = (from: Rgb, to: Rgb, t: number): Rgb => [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];

/** How much of the added/removed foreground color is mixed into the (neutralised) box background. */
const BASE_MIX = 0.25;
const STRONG_MIX = 0.5;

/**
 * Row backgrounds: the theme's `toolDiffAdded` / `toolDiffRemoved` foreground mixed into the grey of the same
 * brightness as the tool box background (`toolSuccessBg`, which pi paints behind a successful tool row; its own
 * hue is dropped, or a green box would turn "red" rows muddy), lightly for the row and more for the words that
 * changed. Derived from the theme, so it suits dark and light themes alike. Truecolor only, and
 * only if the theme has a box background; anything else keeps the foreground-only look.
 */
export function bgTints(theme: Theme): Tints | undefined {
	try {
		const box = rgbOf(theme.getBgAnsi("toolSuccessBg"), 48);
		const add = rgbOf(theme.getFgAnsi("toolDiffAdded"), 38);
		const del = rgbOf(theme.getFgAnsi("toolDiffRemoved"), 38);
		if (!box || !add || !del) return undefined;
		const lum = 0.2126 * box[0] + 0.7152 * box[1] + 0.0722 * box[2];
		const grey: Rgb = [lum, lum, lum];
		const tint = (fg: Rgb): Tint => ({ base: bgOpen(mix(grey, fg, BASE_MIX)), strong: bgOpen(mix(grey, fg, STRONG_MIX)) });
		return { add: tint(add), del: tint(del) };
	} catch {
		return undefined; // themes without color lookup (or a lookup that throws)
	}
}

const SGR_RE = /\x1b\[([0-9;]*)m/y;
/** True if the SGR parameters reset the background (`0`, empty, `49`), skipping the operands of 38/48. */
function resetsBg(params: string): boolean {
	const p = params.split(";");
	for (let i = 0; i < p.length; i++) {
		const v = p[i];
		if (v === "38" || v === "48") i += p[i + 1] === "5" ? 2 : 4;
		else if (v === "" || v === "0" || v === "49") return true;
	}
	return false;
}

export type Span = [from: number, to: number];

/**
 * Put `tint.base` behind an already painted line, `tint.strong` behind visible columns inside `spans`, and keep the
 * background through the painter's own resets. Visible columns are UTF-16 units, as in the plain text.
 */
export function tintLine(ansi: string, tint: Tint, spans: Span[] = []): string {
	let out = "";
	let col = 0;
	let cur = "";
	const set = (want: string) => {
		if (want !== cur) out += (cur = want);
	};
	const want = () => (spans.some(([from, to]) => col >= from && col < to) ? tint.strong : tint.base);
	for (let i = 0; i < ansi.length; ) {
		SGR_RE.lastIndex = i;
		const m = SGR_RE.exec(ansi);
		if (m) {
			out += m[0];
			i += m[0].length;
			if (resetsBg(m[1] ?? "")) cur = ""; // the terminal dropped our background: draw it again on the next char
			continue;
		}
		set(want());
		out += ansi[i];
		i++;
		col++;
	}
	if (!out) return tint.base;
	return `${out}${tint.base}`;
}

const TOKEN_RE = /\w+|\s+|[^\w\s]/g;
/** Beyond this many tokens a line is not diffed word by word (keeps the quadratic LCS trivial). */
const MAX_TOKENS = 300;

/** Contiguous changed tokens → column spans; changed tokens separated only by blanks form one span. */
function spansOf(tokens: string[], changed: boolean[]): Span[] {
	const spans: Span[] = [];
	let col = 0;
	let open: Span | undefined;
	let gap = 0; // columns of blank, unchanged tokens since the open span ended
	tokens.forEach((t, i) => {
		if (changed[i]) {
			if (open && gap > 0) open[1] = col + t.length;
			else if (open && open[1] === col) open[1] += t.length;
			else spans.push((open = [col, col + t.length]));
			gap = 0;
		} else if (open && /^\s+$/.test(t)) gap += t.length;
		else {
			open = undefined;
			gap = 0;
		}
		col += t.length;
	});
	return spans;
}

/**
 * The words that differ inside a removed/added line pair (token LCS, like `diffWords`): every changed word or
 * symbol, so `hi` → `hello` and `42` → `43` in one line are two spans. Undefined when almost the whole line
 * changed (marking everything says nothing) or the lines are too long to diff.
 */
export function changedSpans(a: string, b: string): { del: Span[]; add: Span[] } | undefined {
	const ta = a.match(TOKEN_RE) ?? [];
	const tb = b.match(TOKEN_RE) ?? [];
	if (ta.length > MAX_TOKENS || tb.length > MAX_TOKENS) return undefined;
	const lcs: number[][] = Array.from({ length: ta.length + 1 }, () => new Array<number>(tb.length + 1).fill(0));
	for (let i = ta.length - 1; i >= 0; i--) {
		for (let j = tb.length - 1; j >= 0; j--) {
			lcs[i]![j] = ta[i] === tb[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
		}
	}
	const delChanged = ta.map(() => true);
	const addChanged = tb.map(() => true);
	for (let i = 0, j = 0; i < ta.length && j < tb.length; ) {
		if (ta[i] === tb[j]) delChanged[i++] = addChanged[j++] = false;
		else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) i++;
		else j++;
	}
	const del = spansOf(ta, delChanged);
	const add = spansOf(tb, addChanged);
	const size = (spans: Span[]) => spans.reduce((n, [f, t]) => n + t - f, 0);
	const body = (t: string) => Math.max(1, t.trim().length);
	if (size(del) > 0.8 * body(a) && size(add) > 0.8 * body(b)) return undefined;
	return { del, add };
}

/** Pair each run of removed lines with the run of added lines right after it (same size), one to one. */
function wordSpans(shown: DiffEntry[]): Map<DiffEntry, Span[]> {
	const spans = new Map<DiffEntry, Span[]>();
	for (let i = 0; i < shown.length; ) {
		if (shown[i]?.kind !== "del") {
			i++;
			continue;
		}
		let j = i;
		while (shown[j]?.kind === "del") j++;
		let k = j;
		while (shown[k]?.kind === "add") k++;
		if (j - i === k - j) {
			for (let n = 0; n < j - i; n++) {
				const d = shown[i + n];
				const a = shown[j + n];
				const sp = d && a ? changedSpans(d.text, a.text) : undefined;
				if (d && a && sp) {
					spans.set(d, sp.del);
					spans.set(a, sp.add);
				}
			}
		}
		i = Math.max(k, i + 1);
	}
	return spans;
}

const visibleLength = (s: string): number => s.replace(/\x1b\[[0-9;]*m/g, "").length;

/**
 * One styled row per entry (only the first `max` are painted; `total` is the real count).
 * Each side of the change is highlighted as a block (old = context + removed, new = context + added), so
 * multi-line strings and comments tokenize in context. With `tints`, changed rows get a background that runs to
 * the edge of the terminal and the words that changed a stronger one.
 */
export function diffRows(theme: Theme, diff: string, path: string, max: number, shiki?: ShikiPaint, tints: Tints | undefined = bgTints(theme)): { rows: string[]; total: number } {
	const all = parseDiff(diff);
	const shown = all.slice(0, max);
	const paintSide = (keep: (e: DiffEntry) => boolean): Map<DiffEntry, string> => {
		const side = shown.filter((e) => e.kind !== "gap" && keep(e));
		const painted = paintLines(theme, side.map((e) => e.text), path, shiki);
		return new Map(side.map((e, i) => [e, painted[i] ?? e.text] as const));
	};
	const oldSide = paintSide((e) => e.kind !== "add");
	const newSide = paintSide((e) => e.kind !== "del");
	const spans = tints ? wordSpans(shown) : new Map<DiffEntry, Span[]>();
	const width = String(Math.max(0, ...shown.map((e) => e.no))).length;
	const rows = shown.map((e) => {
		if (e.kind === "gap") return theme.fg("dim", `${" ".repeat(width)} ⋯`);
		const code = (e.kind === "del" ? oldSide : newSide).get(e) ?? e.text;
		const gutter = theme.fg(COLOR[e.kind], `${String(e.no).padStart(width)} ${SIGN[e.kind]}`);
		const tint = tints && (e.kind === "add" || e.kind === "del") ? tints[e.kind] : undefined;
		if (!tint) return `${gutter} ${code}`;
		const span = visibleLength(code) === e.text.length ? spans.get(e) : undefined; // painter must not alter the text
		return fillRow(`${tint.base}${gutter} ${tintLine(code, tint, span)}`, tint.base);
	});
	return { rows, total: all.length };
}

/** Rows for a freshly written file: green `+` gutter, highlighted code. */
export function writeRows(theme: Theme, lines: string[], path: string, max: number, shiki?: ShikiPaint): string[] {
	const shown = lines.slice(0, max);
	const painted = paintLines(theme, shown, path, shiki);
	const width = String(lines.length).length;
	return shown.map((_, i) => `${theme.fg("toolDiffAdded", `${String(i + 1).padStart(width)} +`)} ${painted[i] ?? ""}`);
}
