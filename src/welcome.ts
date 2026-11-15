/**
 * Persistent start screen: a boxed, two-column header (logo, model, tips, loaded resources, recent
 * sessions) that stays at the top of the transcript like pi's own header.
 *
 * The layout (rounded box, `Welcome back!`, Tips / Loaded / Recent sessions) follows
 * nicobailon/pi-powerline-footer v0.22.0 (`welcome.ts`), MIT. The logo is NOT that project's block
 * approximation: it is pi's real logo (`pi-logo.js` of pi-coding-agent: 4x4 pixels, coral / blue /
 * yellow), scaled up, in those fixed colors. The rest of the box takes its colors from the theme
 * (`accent`, `border`, `mdHeading`: coral, blue, yellow in the bundled pi-dark / pi-light themes).
 */
import { existsSync } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { BLUE, CORAL, YELLOW } from "./palette.ts";
import { backgroundAnsi, type Component, foregroundAnsi, type RgbColorValue, type TerminalColorMode, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// ── pi's logo ────────────────────────────────────────────────────────────────


type Pixel = RgbColorValue | undefined;
const C = CORAL;
const B = BLUE;
const Y = YELLOW;
/** The logo as pi draws it in its header (see `piLogoLines`): 4x4 square pixels. */
export const PI_PIXELS: readonly (readonly Pixel[])[] = [
	[C, C, C, undefined],
	[B, undefined, C, undefined],
	[B, B, undefined, Y],
	[B, undefined, undefined, Y],
];

const RESET = "\x1b[0m";

/**
 * The logo scaled by `scale`: `4 * scale` columns and `2 * scale` lines. A terminal cell is twice as tall
 * as wide, so one pixel is `scale` columns by `scale` half-blocks, which keeps the pixels square.
 */
export function piLogo(mode: TerminalColorMode, scale = 3): string[] {
	const size = 4 * scale;
	const at = (half: number, col: number): Pixel => PI_PIXELS[Math.floor(half / scale)]?.[Math.floor(col / scale)];
	const same = (a: Pixel, b: Pixel) => a === b;
	const lines: string[] = [];
	for (let line = 0; line < size / 2; line++) {
		let out = "";
		for (let col = 0; col < size; col++) {
			const top = at(2 * line, col);
			const bottom = at(2 * line + 1, col);
			if (!top && !bottom) out += " ";
			else if (top && same(top, bottom)) out += `${foregroundAnsi(top, mode)}█`;
			else if (top && bottom) out += `${foregroundAnsi(top, mode)}${backgroundAnsi(bottom, mode)}▀\x1b[49m`;
			else if (top) out += `${foregroundAnsi(top, mode)}▀`;
			else if (bottom) out += `${foregroundAnsi(bottom, mode)}▄`;
		}
		lines.push(out + RESET);
	}
	return lines;
}

// ── data ─────────────────────────────────────────────────────────────────────

export interface RecentSession {
	name: string;
	timeAgo: string;
}

interface LoadedCounts {
	contextFiles: number;
	skills: number;
	promptTemplates: number;
}

export interface WelcomeData {
	modelName: string;
	providerName: string;
	version?: string;
	/** `undefined` while the session archive is being read. */
	recentSessions: RecentSession[] | undefined;
	loaded: LoadedCounts;
	/** Key hints, already formatted (`Shift+Tab`, …), in display order. */
	tips: { key: string; label: string }[];
}

/** What a theme has to provide for the start screen (a subset of pi's `Theme`). */
export interface WelcomeTheme {
	fg(color: "dim" | "accent" | "border" | "mdHeading", text: string): string;
	bold(text: string): string;
	getColorMode(): TerminalColorMode;
}

// ── rendering ────────────────────────────────────────────────────────────────

const LEFT_COL = 26;
const MIN_BOX = 76;
const MAX_BOX = 96;
/** Below this the two columns do not fit: only the logo and the wordmark are drawn. */
const MIN_LAYOUT = 44;

function formatCount(n: number, one: string, many = `${one}s`): string {
	return `${n} ${n === 1 ? one : many}`;
}

function fit(text: string, width: number): string {
	const w = visibleWidth(text);
	if (w > width) return truncateToWidth(text, width, "…");
	return text + " ".repeat(width - w);
}

function center(text: string, width: number): string {
	const w = visibleWidth(text);
	if (w >= width) return truncateToWidth(text, width, "…");
	const left = Math.floor((width - w) / 2);
	return " ".repeat(left) + text + " ".repeat(width - w - left);
}

/** Pure renderer: every returned line is at most `width` columns wide. */
export function renderWelcome(data: WelcomeData, theme: WelcomeTheme, width: number): string[] {
	const mode = theme.getColorMode();
	const dim = (text: string) => theme.fg("dim", text);
	const wordmark = dim(`Pi${data.version ? ` v${data.version}` : ""}`); // one plain tone: the logo carries the brand colors

	if (width < MIN_LAYOUT) {
		const [top = "", bottom = ""] = piLogo(mode, 1);
		return [`${top} ${wordmark}`, `${bottom} ${dim(data.modelName)}`].map((l) => truncateToWidth(l, width, "…"));
	}

	const boxWidth = Math.min(width, Math.max(MIN_BOX, Math.min(width - 2, MAX_BOX)));
	const leftCol = LEFT_COL;
	const rightCol = Math.max(1, boxWidth - leftCol - 3);
	const rule = (n: number) => dim("─".repeat(Math.max(0, n)));

	const left = [
		"",
		center(theme.bold("Welcome back!"), leftCol),
		"",
		...piLogo(mode).map((l) => center(l, leftCol)),
		"",
		center(theme.fg("accent", data.modelName), leftCol),
		center(dim(data.providerName), leftCol),
	];

	const separator = ` ${rule(rightCol - 2)}`;
	const heading = (color: "accent" | "border" | "mdHeading", text: string) => ` ${theme.bold(theme.fg(color, text))}`;
	const bullet = dim("- ");
	const { contextFiles, skills, promptTemplates } = data.loaded;
	const counts = [
		contextFiles > 0 && formatCount(contextFiles, "context file"),
		skills > 0 && formatCount(skills, "skill"),
		promptTemplates > 0 && formatCount(promptTemplates, "prompt template"),
	]
		.filter((s): s is string => !!s)
		.map((s) => ` ${bullet}${theme.fg("border", s.split(" ", 1)[0] as string)}${s.slice(s.indexOf(" "))}`);
	const recent = data.recentSessions;
	const recentLines =
		recent === undefined
			? [` ${dim("…")}`]
			: recent.length === 0
				? [` ${dim("No recent sessions")}`]
				: recent.slice(0, 3).map((s) => ` ${dim("• ")}${theme.fg("accent", s.name)}${dim(` (${s.timeAgo})`)}`);

	const right = [
		heading("mdHeading", "Tips"),
		...data.tips.map((t) => ` ${dim(`${t.key} `)}${t.label}`),
		separator,
		heading("border", "Loaded"),
		...(counts.length > 0 ? counts : [` ${dim("No context files, skills or prompts")}`]),
		separator,
		heading("accent", "Recent sessions"),
		...recentLines,
		"",
	];

	const v = dim("│");
	const title = ` ${wordmark} `;
	const top = dim("╭───") + title + rule(boxWidth - 2 - 3 - visibleWidth(title)) + dim("╮");
	const rows = Math.max(left.length, right.length);
	const body: string[] = [];
	for (let i = 0; i < rows; i++) body.push(v + fit(left[i] ?? "", leftCol) + v + fit(right[i] ?? "", rightCol) + v);
	const bottom = dim("╰") + rule(leftCol) + dim("┴") + rule(rightCol) + dim("╯");
	return [top, ...body, bottom].map((l) => truncateToWidth(l, width, ""));
}

/** The header component: lines are cached per width until the data or the theme changes. */
export class WelcomeHeader implements Component {
	private cache: { key: string; lines: string[] } | undefined;

	constructor(
		private readonly getData: () => WelcomeData,
		private readonly getTheme: () => WelcomeTheme,
	) {}

	invalidate(): void {
		this.cache = undefined;
	}

	render(width: number): string[] {
		try {
			const data = this.getData();
			const key = `${width}|${JSON.stringify(data)}`;
			if (this.cache?.key !== key) this.cache = { key, lines: renderWelcome(data, this.getTheme(), width) };
			return this.cache.lines;
		} catch {
			return [];
		}
	}
}

// ── discovery ────────────────────────────────────────────────────────────────

const CONTEXT_FILES = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];

/** Context files pi loads: one per directory (global agent dir, then the working directory and its ancestors). */
export function countContextFiles(cwd: string, agentDir: string, exists: (p: string) => boolean = existsSync): number {
	const has = (dir: string) => CONTEXT_FILES.some((f) => exists(join(dir, f)));
	let n = has(resolve(agentDir)) ? 1 : 0;
	let dir = resolve(cwd);
	const seen = new Set<string>([resolve(agentDir)]);
	for (;;) {
		if (!seen.has(dir) && has(dir)) n++;
		seen.add(dir);
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return n;
}

export function formatTimeAgo(ms: number): string {
	const minutes = Math.floor(ms / 60_000);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	if (days > 0) return `${days}d ago`;
	if (hours > 0) return `${hours}h ago`;
	if (minutes > 0) return `${minutes}m ago`;
	return "just now";
}

const HEADER_BYTES = 8192;

async function projectOf(file: string, fallback: string): Promise<string> {
	const fh = await open(file, "r").catch(() => undefined);
	if (!fh) return fallback;
	try {
		const buf = Buffer.alloc(HEADER_BYTES);
		const { bytesRead } = await fh.read(buf, 0, HEADER_BYTES, 0);
		const first = buf.toString("utf8", 0, bytesRead).split(/\r?\n/, 1)[0]?.trim();
		const cwd = first ? (JSON.parse(first) as { cwd?: unknown }).cwd : undefined;
		return typeof cwd === "string" && cwd.trim() ? basename(cwd) || cwd : fallback;
	} catch {
		return fallback;
	} finally {
		await fh.close().catch(() => {});
	}
}

/**
 * Newest session of each of the last `max` distinct projects under `<agentDir>/sessions/<project>/*.jsonl`.
 * Only file names and the first line of the newest files are read; aborts between operations.
 */
export async function recentSessions(agentDir: string, max: number, signal?: AbortSignal, now = Date.now()): Promise<RecentSession[]> {
	const root = join(agentDir, "sessions");
	const files: { file: string; dir: string; mtime: number }[] = [];
	const dirs = await readdir(root, { withFileTypes: true }).catch(() => []);
	for (const d of dirs) {
		if (!d.isDirectory()) continue;
		signal?.throwIfAborted();
		const dir = join(root, d.name);
		const names = await readdir(dir).catch(() => [] as string[]);
		const stats = await Promise.all(
			names
				.filter((n) => n.endsWith(".jsonl"))
				.map(async (n) => {
					const file = join(dir, n);
					const s = await stat(file).catch(() => undefined);
					return s?.isFile() ? { file, dir, mtime: s.mtimeMs } : undefined;
				}),
		);
		for (const s of stats) if (s) files.push(s);
	}
	files.sort((a, b) => b.mtime - a.mtime);
	const seen = new Set<string>();
	const out: RecentSession[] = [];
	for (const f of files) {
		signal?.throwIfAborted();
		const name = await projectOf(f.file, basename(f.dir).replace(/^--|--$/g, "").split("-").filter(Boolean).at(-1) ?? basename(f.dir));
		if (seen.has(name)) continue;
		seen.add(name);
		out.push({ name: name.length > 20 ? `${name.slice(0, 17)}…` : name, timeAgo: formatTimeAgo(now - f.mtime) });
		if (out.length >= max) break;
	}
	return out;
}
