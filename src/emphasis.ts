/**
 * Display-only emphasis for assistant replies: `[[Done]]` pills, labeled headings, colored bold.
 * Ported from johnlindquist/pi-emphasis v0.2.0 (MIT, Copyright (c) 2026 John Lindquist; see NOTICE.md),
 * changed to need no Nerd Font: plain Unicode icons instead of Private Use Area glyphs, square pill
 * chips instead of rounded caps, settings from `lumen.emphasis` instead of environment variables,
 * and a short prompt guidance next to the full one.
 *
 * Stored messages, copied text and HTML exports keep the original Markdown.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { EmphasisGuidance, LumenConfig } from "./config.ts";

type Colorize = (text: string) => string;
export type PillTone = "success" | "error" | "warning" | "danger" | "mode" | "owner" | "neutral";

export interface Palette {
	/** Wraps bold text in a color. */
	bold: Colorize;
	passed?: Colorize;
	failed?: Colorize;
	/** Opening escapes for each pill tone (the label colors). */
	pills?: Record<PillTone, string>;
	/** Colors for arrows and tree connectors. */
	arrow?: Colorize;
	tree?: Colorize;
	/** Icons on pills, headings and lead-ins. */
	icons: boolean;
}

/** Minimal slice of Pi's Theme used to build a palette. */
export interface ThemeLike {
	fg(color: never, text: string): string;
	getFgAnsi(color: never): string;
	getBgAnsi(color: never): string;
}

/** Each tone's words. `core` are the words agents are told to write; `also` are accepted and colored the same. */
export const VOCABULARY: Record<Exclude<PillTone, "neutral">, { core: string[]; also: string[] }> = {
	error: { core: ["Failed", "Blocked", "Broken", "Unsafe"], also: ["fail", "failing", "error", "rejected", "down"] },
	warning: { core: ["Needs you", "Decision", "Unverified", "Partial", "Skipped", "In progress", "Pending", "At risk"], also: ["needs review", "waiting", "review", "todo", "stale", "draft"] },
	success: { core: ["Done", "Passed", "Observed", "Fixed", "Live", "Recommended", "Keep"], also: ["pass", "ready", "merged", "safe", "verified", "shipped", "ok", "approved", "complete", "completed", "finished", "healthy"] },
	danger: { core: ["Costs money", "Destructive", "Irreversible"], also: [] },
	mode: { core: ["Brainstorm", "Investigate", "Preview", "Implement", "Qualify"], also: [] },
	owner: { core: ["Owned", "Shared", "Foreign"], also: [] },
};
/** Words that are soft blue like any unknown label, but have an icon and a place in the guidance. */
export const CONTEXT_WORDS = ["Inferred", "New", "Changed", "Optional"];

const TONE_WORDS = Object.fromEntries(
	Object.entries(VOCABULARY).map(([tone, words]) => [tone, [...words.core, ...words.also].map((w) => w.toLowerCase())]),
) as Record<Exclude<PillTone, "neutral">, string[]>;

// Icons are plain Unicode (Dingbats, Geometric Shapes, Arrows): one cell wide and present in ordinary
// monospace fonts, no Nerd Font. Words without an entry stay text-only. "→" is not used as an icon
// because the arrow colorizer would recolor it.
const CHECK = "✓";
const CROSS = "✗";
/** The icon each known pill word carries. */
const PILL_ICONS: Record<string, string> = {
	done: CHECK, passed: CHECK, pass: CHECK, complete: CHECK, completed: CHECK, ok: CHECK, verified: CHECK, ready: CHECK, fixed: CHECK, approved: CHECK, safe: CHECK,
	observed: "◉", recommended: "★", live: "●", shipped: "↑", keep: "◆", merged: "⎇", healthy: "♥",
	failed: CROSS, fail: CROSS, failing: CROSS, error: CROSS, rejected: CROSS, broken: CROSS,
	blocked: "⊘", unsafe: "!", down: "↓",
	"needs you": "▸", decision: "⎇", unverified: "?", "at risk": "!", "in progress": "◐", partial: "◑", pending: "…", waiting: "…", skipped: "↷",
	todo: "☐", review: "◉", draft: "✎",
	inferred: "∴", new: "+", changed: "~", optional: "○",
	"costs money": "$", destructive: "✖", irreversible: "‼",
	brainstorm: "✦", investigate: "◎", preview: "◉", implement: "▸", qualify: "◆",
	owned: "●", shared: "⇄", foreign: "◌",
};

/** Words that display as one canonical word, so the same state always reads the same. */
const SYNONYMS: Record<string, string> = {
	complete: "Done", completed: "Done", ok: "Done", finished: "Done", pass: "Passed",
	fail: "Failed", failing: "Failed", error: "Failed", waiting: "Pending", "needs review": "Review",
};

/** The icon a heading or a line's leading bold label takes from its word. */
const LABEL_ICONS: Record<string, string> = {
	finding: "◎", evidence: "◎", status: "◉", result: "◆", verdict: "§", rule: "§", cause: "↳", effect: "↯", fix: "✚",
	risk: "!", limits: "!", cost: "$", decision: "⎇", options: "☰", plan: "☰", next: "▸", why: "?", how: "»",
	rollback: "↶", undo: "↶", review: "◉", checked: CHECK, example: "▫", scoreboard: "≡", terminal: "❯", folder: "▣",
	file: "▤", branch: "⎇", ideas: "✦", pills: "●", colors: "◐", icons: "★",
};

// A label may open with its own Private Use Area glyph (a Nerd Font icon the user typed), which wins over the table's icon.
const OWN_ICON = /^\s*([\ue000-\uf8ff]|[\u{f0000}-\u{ffffd}])\s*/u;

const KNOWN = [...new Set([...Object.values(TONE_WORDS).flat(), ...Object.keys(PILL_ICONS), ...Object.keys(SYNONYMS)])].sort((a, b) => b.length - a.length);

/** A pill label read as its word: a known word may be followed by detail ("Passed 12/12", "Failed: 3 tests"). */
function splitLabel(label: string): { icon: string | undefined; word: string; key: string } {
	const own = label.match(OWN_ICON);
	const text = (own ? label.slice(own[0].length) : label).replace(/\s+/g, " ").trim();
	const lower = text.toLowerCase();
	const known = KNOWN.find((k) => lower === k || (lower.startsWith(k) && /[ :]/.test(lower[k.length] ?? "")));
	const canonical = known ? SYNONYMS[known] : undefined;
	const key = (canonical ?? known ?? lower).toLowerCase();
	const word = canonical && known ? canonical + text.slice(known.length) : text;
	return { icon: own?.[1] ?? PILL_ICONS[key], word, key };
}

export function toneOf(label: string): PillTone {
	const { key } = splitLabel(label);
	for (const tone of ["danger", "error", "warning", "success", "mode", "owner"] as const) {
		if (TONE_WORDS[tone].includes(key)) return tone;
	}
	return "neutral";
}

/** Solid chip in the terminal's own red, cyan or blue: louder than the panel-colored tones. */
const solid = (code: number) => `\x1b[${code}m\x1b[7m`;

export function createPalette(theme: ThemeLike, boldColor = "mdLink", icons = true): Palette {
	const fg = (name: string) => (text: string) => theme.fg(name as never, text);
	const tone = (labelFg: string, bg: string) => {
		const bgAnsi = theme.getBgAnsi(bg as never);
		// A theme without its own panel colors (Pi's system theme when the terminal reports
		// none) draws pills in reverse video: the tone's color becomes the background.
		if (!bgAnsi || /^\x1b\[49m$/.test(bgAnsi)) return `${theme.getFgAnsi((labelFg === "text" ? "accent" : labelFg) as never)}\x1b[7m`;
		return bgAnsi + theme.getFgAnsi(labelFg as never);
	};
	return {
		bold: fg(boldColor),
		passed: fg("success"),
		failed: fg("error"),
		pills: {
			success: tone("success", "toolSuccessBg"),
			error: tone("error", "toolErrorBg"),
			warning: tone("warning", "searchMatchBg"),
			neutral: tone("text", "selectedBg"),
			danger: solid(31),
			mode: solid(36),
			owner: solid(34),
		},
		arrow: fg("accent"),
		tree: fg("dim"),
		icons,
	};
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
// Escaped bold markers, bold markers, or a [[pill]] of 1-32 characters.
const PILL = /\[\[([^\[\]\n]{1,32})\]\]/g;
const INLINE = /(\\*)(\*\*|__)|\[\[([^\[\]\n]{1,32})\]\]/g;

/** Apply colors to assistant Markdown, leaving code blocks, inline code and headings alone. */
export function decorate(markdown: string, palette: Palette): string {
	const [open = "", close = ""] = palette.bold("\u0000").split("\u0000");
	const out: string[] = [];
	let fence: string | undefined;
	for (const line of markdown.split("\n")) {
		const fenceMatch = line.match(FENCE);
		const mark = fenceMatch?.[1];
		if (fence) {
			if (mark && mark[0] === fence[0] && mark.length >= fence.length) fence = undefined;
			out.push(line);
		} else if (mark) {
			fence = mark;
			out.push(line);
		} else if (/^ {0,3}#{1,6}\s/.test(line)) {
			out.push(line.replace(/^( {0,3}#{1,6}\s+)(.+)$/, (_, hashes: string, title: string) => hashes + pillsIn(withLabelIcon(title, palette.icons), palette))); // Pi already colors headings; a pill the model put there still becomes a chip, never raw `[[...]]`.
		} else {
			out.push(decorateLine(line, palette, open, close));
		}
	}
	return out.join("\n");
}

/** Lead-in words that name the action a pill calls for. With a colon they take an icon anywhere in a line. */
const ACTION_ICONS: Record<string, string> = {
	check: "◇", do: "▸", next: "▸", unblock: "↗", left: "…", run: "▷", guard: "◆", undo: "↶", see: "↗",
};
const ACTION_LABEL = new RegExp(`(\\*\\*)(${Object.keys(ACTION_ICONS).join("|")})(:\\*\\*)`, "gi");

/** Prefix a known label with its icon, unless it already opens with a glyph. */
function withLabelIcon(label: string, icons: boolean): string {
	if (!icons || OWN_ICON.test(label)) return label;
	const word = label.replace(/[:\s]+$/, "").trim().toLowerCase();
	const icon = LABEL_ICONS[word] ?? (label.trimEnd().endsWith(":") ? ACTION_ICONS[word] : undefined);
	return icon ? `${icon} ${label}` : label;
}

// A line's leading bold label, after an optional list marker or tree connector.
const LEAD_LABEL = /^(\s*(?:[-*+]|\d+\.)?\s*(?:[├└]──\s*)?\*\*)([^*`\n]{1,32})(\*\*)/;

function pill(label: string, palette: Palette): string {
	const open = palette.pills?.[toneOf(label)] ?? "";
	const { icon, word } = splitLabel(label);
	// No-break spaces pad the chip and keep a two-word pill on one line when Pi wraps the paragraph.
	const text = (icon && word && palette.icons ? `${icon} ${word}` : word || label.trim()).replace(/ /g, "\u00a0");
	return `${open}\x1b[1m\u00a0${text}\u00a0\x1b[22;27m\x1b[39m\x1b[49m`;
}

/** Turn the `[[pill]]`s of a text into chips, leaving all other text as it is. */
function pillsIn(text: string, palette: Palette): string {
	if (!palette.pills) return text;
	return text.replace(PILL, (match, label: string) => (label.trim() ? pill(label, palette) : match));
}

function decorateLine(line: string, palette: Palette, open: string, close: string): string {
	// Odd parts are inline code spans, which stay untouched.
	const parts = line.replace(LEAD_LABEL, (_, before: string, label: string, after: string) => before + withLabelIcon(label, palette.icons) + after).split(/(`+[^`]*?`+)/g);
	let result = "";
	let inBold: string | undefined;
	const reopen = () => (inBold ? `\x1b[1m${open}` : "");
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i] ?? "";
		if (i % 2 === 1) {
			// Pi's code color ends with a foreground reset; restore the bold color after it.
			result += inBold ? `${part}${open}` : part;
			continue;
		}
		let prose = part;
		if (palette.icons) prose = prose.replace(ACTION_LABEL, (_, before: string, word: string, after: string) => `${before}${ACTION_ICONS[word.toLowerCase()]} ${word}${after}`);
		if (palette.passed) prose = prose.replace(/[✓✔]/g, (m) => palette.passed?.(m) + (inBold ? open : ""));
		if (palette.failed) prose = prose.replace(/[✗✘]/g, (m) => palette.failed?.(m) + (inBold ? open : ""));
		if (palette.arrow) prose = prose.replace(/→/g, (m) => palette.arrow?.(m) + (inBold ? open : ""));
		if (palette.tree) prose = prose.replace(/[├└]──/g, (m) => palette.tree?.(m) + (inBold ? open : ""));
		result += prose.replace(INLINE, (match, slashes: string | undefined, marker: string | undefined, label: string | undefined) => {
			if (label !== undefined) {
				if (!palette.pills || !label.trim()) return match;
				return pill(label, palette) + reopen();
			}
			if ((slashes ?? "").length % 2 === 1) return match; // escaped marker
			if (!inBold) {
				inBold = marker;
				return `${slashes}${marker}${open}`;
			}
			if (inBold === marker) {
				inBold = undefined;
				return `${slashes}${close}${marker}`;
			}
			return match;
		});
	}
	// An unclosed span (streaming or literal asterisks) ends its color at the line end.
	if (inBold) result += close;
	return result;
}

const pills = (words: string[]) => words.map((w) => `[[${w}]]`).join(", ");
const titled = (words: string[]) => words.map((w) => (w[0] ?? "").toUpperCase() + w.slice(1)).join(", ");

/** About 200 tokens: only the pill syntax and the three attention colors. */
function shortGuidance(): string {
	const v = VOCABULARY;
	return `Replies are drawn in a terminal that colors pills. Mark a state or an ask with \`[[Word]]\` beside the thing it describes; the terminal adds the color and an icon from the word. Use exactly these words:
- Red, something is wrong: ${pills(v.error.core)}.
- Yellow, look here: ${pills(v.warning.core)}. [[Needs you]] is an action only the user can take; [[Decision]] is a call only the user makes; [[Unverified]] means you could not check (if you can run the check yourself, do it and report the result).
- Green, settled: ${pills(v.success.core)}.
A known word may carry short detail: [[Passed 12/12]], [[Failed: 3 tests]]. Never leave a red or yellow pill alone: follow it with the one fact the user needs, introduced by a bold lead-in ending in a colon (**Do:** for [[Needs you]], **Check:** for [[Unverified]], **Next:** for [[Failed]] or [[Decision]], **Unblock:** for [[Blocked]], **Left:** for [[Partial]]). One pill per bullet. Never put pills in headings, paths, commands, code or machine-readable output, and omit them when the user asks for plain text or an exact format. Do not invent new status words.`;
}

function fullGuidance(): string {
	const v = VOCABULARY;
	return `These rules shape replies written to the user in this terminal. It colors pills, adds small icons, and cannot change text size.

- **Label every reply.** Start the first substantive line with a bold label, even for a one-line update, and give each subject in a multi-part reply a short heading or a bullet with a bold lead label. Write the label as a plain word; the terminal adds its icon. Never type icon glyphs. Labels with an icon: ${titled(Object.keys(LABEL_ICONS))}. Prefer these; any other label shows without an icon.
- **Shape follows information.** Use \`├──\` and \`└──\` for what belongs to what, \`→\` for a sequence, \`✓\` or \`✗\` beside a checked item. Write tree rows as indented lines directly under their parent with no list dash, one line per row. A one-line answer can stay one line.
- **Bold the anchor terms.** Treat the projects, components, choices, options, and statuses under discussion as the nodes of a graph, and bold them where they carry the point: a first mention in a section, a bullet's lead label such as **Cause:**, and the recommendation or decision the user must make. One to three bold spans per paragraph or bullet; bolding every noun erases the signal. Italicize sparingly, for contrast and meaning-changing words such as *not*, *only*, or *unverified*.
- **Pills are required, not optional.** A pill is \`[[Word]]\` beside the subject it describes; the terminal colors it and adds its icon from the word. A pill names a state or an ask, never an adjective. Use exactly these words so the same state always reads the same:
  - **Red, something is wrong:** ${pills(v.error.core)}. Every failure and blocker carries one.
  - **Yellow, look here:** ${pills(v.warning.core)}. [[Needs you]] is an action only the user can take; [[Decision]] is a call only the user makes. Every ask and every unchecked claim carries one.
  - **Green, settled:** ${pills(v.success.core)}.
  - **Solid red, consequences:** ${pills(v.danger.core)}. Required beside any action that has one, before taking it.
  - **Cyan, kind of work:** open every substantive reply with the kind of work you understood the request to be: ${pills(v.mode.core)}. Brainstorm is options and a recommendation, Investigate is evidence, Preview and Implement are a working result, Qualify is rigorous proof.
  - **Blue, ownership:** ${pills(v.owner.core)} beside any program, file, service, or configuration you changed or propose to change outside the task's own files: created by this task, also used by others, or belonging to someone else.
  - **Soft blue, context:** ${pills(CONTEXT_WORDS)}, and any other short label.
- **Pill placement.** Mark evidence claims with [[Observed]] (witnessed in the real system), [[Inferred]] (reasoned from other signals), or [[Unverified]] (not checked). A known word may carry short detail: [[Passed 12/12]], [[Failed: 3 tests]]. One pill per bullet or table cell, with two exceptions: a sequence line joined by \`→\`, and a scoreboard, which is one line of counts such as [[Done 6]] [[Failed 1]] [[Needs you 1]] under the opening sentence of a long report. In a long reply, repeat every [[Needs you]] and [[Decision]] in a closing line. Never put pills in headings, and do not invent new status words.
- **Every attention pill carries its action.** Follow the pill with the one fact the user needs to act on it, introduced by a bold lead-in word ending in a colon. These lead-ins get an icon: ${titled(Object.keys(ACTION_ICONS))}. Required for every red, yellow, and solid red pill and for [[Inferred]]; optional for green ones.
  - [[Unverified]] means you *could not* check. If you can run the check yourself, run it and report the result instead. Otherwise give the fastest check and who can run it: "the new color on your screen. **Check:** reload and look at the first pill."
  - [[Needs you]]: the exact action and what it unblocks. "**Do:** sign in to the staging dashboard; then I can read the deploy log."
  - [[Decision]]: the options, your pick, and what you will do meanwhile. "Backfill, or make the column optional? I'd backfill. **Next:** I'll prepare it as a dry run."
  - [[Failed]] or [[Broken]]: the cause and what you are doing about it. "Migration stopped on 41 empty rows. **Next:** preparing a backfill."
  - [[Blocked]]: what blocks it and the smallest thing that unblocks it. "No access to the billing repository. **Unblock:** read access for this session."
  - [[Partial]] or [[In progress]]: what remains. "3 of 5 pages converted. **Left:** pricing and checkout."
  - [[Skipped]]: why, and how to run it anyway. "Load test, which you waived. **Run:** \`npm run load\`."
  - [[At risk]] or [[Unsafe]]: what would make it fail and the guard against it. "Breaks if billing reads the old column. **Guard:** keep both columns for one release."
  - [[Costs money]]: the amount, before acting. "About $4 for 20 video generations."
  - [[Destructive]] or [[Irreversible]]: what is lost and how to get it back, or that nothing can. "Deletes 41 order rows. **Undo:** none; export them first."
  - [[Shared]] or [[Foreign]]: who else is affected. "Every session picks this up on its next reload."
  - [[Inferred]]: what it was inferred from. "From the last three deploy logs; I did not reproduce it."
  - [[Done]], [[Fixed]], or [[Live]]: where to see it. "**See:** the address, file, or command that shows it."
- **Headings and code.** Use \`##\` headings; \`###\` and deeper show their hash marks. Reserve inline code for literals the user may copy or search (paths, commands, exact identifiers); otherwise name subjects in plain words. Blockquotes render dim: asides only, never a caveat the user must see.
- **Copyable text stays clean.** Keep pills out of paths, commands, code, literal output, and machine-readable data. Omit pills and tree shapes when the user asks for plain text, ASCII, or an exact format.`;
}


/** The reply-style rules given to the model, with every word list read from the tables that draw them. */
export function replyGuidance(mode: Exclude<EmphasisGuidance, "off">): string {
	return mode === "full" ? fullGuidance() : shortGuidance();
}

export interface Emphasis {
	/** Call on `session_start`: pills are drawn only where Pi has a terminal UI. */
	start(ctx: ExtensionContext): void;
	stop(): void;
}

export function registerEmphasis(pi: ExtensionAPI, getCfg: () => LumenConfig): Emphasis {
	let theme: (() => ThemeLike) | undefined;
	let built: { theme: ThemeLike; key: string; palette: Palette } | undefined;
	const on = (): boolean => theme !== undefined && getCfg().emphasis.enabled;

	// The rules travel with the renderer: only a session that draws pills is told to write them.
	pi.on("before_agent_start", (event) => {
		const { guidance } = getCfg().emphasis;
		if (on() && guidance !== "off") event.systemPromptOptions.sections.reply_style = replyGuidance(guidance);
		else delete event.systemPromptOptions.sections.reply_style;
	});
	pi.registerMarkdownTransformer(
		(markdown) => {
			if (!theme || !on()) return markdown;
			const { color, icons } = getCfg().emphasis;
			// Rebuild when the theme or the settings change, so /theme switches recolor new output.
			const current = theme();
			const key = `${color}|${icons}`;
			if (built?.theme !== current || built.key !== key) built = { theme: current, key, palette: createPalette(current, color, icons) };
			return decorate(markdown, built.palette);
		},
		{ messageTypes: ["assistant"] },
	);

	return {
		start(ctx) {
			theme = ctx.mode === "tui" ? () => ctx.ui.theme : undefined;
			built = undefined;
		},
		stop() {
			theme = undefined;
			built = undefined;
		},
	};
}
