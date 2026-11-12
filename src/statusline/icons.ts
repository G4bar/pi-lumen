/**
 * Nerd Font icons for the status line.
 * Codepoints and the terminal heuristic come from nicobailon/pi-powerline-footer (icons.ts, MIT), which takes them
 * from oh-my-pi; the per-level thinking glyphs are its `THINKING_TEXT_NERD`.
 */

export type IconMode = "none" | "nerd" | "auto";

export const NERD = {
	model: "\u{F09D1} ", // nf-md glyph kept from the previous release
	dir: "\uF115 ", // nf-fa-folder_open
	git: "\uF126 ", // nf-fa-code_fork
	context: "\uF1C0 ", // nf-fa-database
	cost: "\uF155", // nf-fa-dollar
} as const;

const THINK_NERD: Record<string, string> = {
	minimal: "\uF0E7", // lightning bolt
	low: "\uF10C", // circle outline
	medium: "\uF192", // dot circle
	high: "\uF111", // circle
	xhigh: "\uF06D", // fire
};

/** Glyph for a thinking level, followed by a space; empty for levels without one (off, max). */
export function thinkIcon(level: string): string {
	const g = THINK_NERD[level];
	return g ? `${g} ` : "";
}

/** Terminal-name heuristic (not a detection of the configured font); `POWERLINE_NERD_FONTS=1|0` overrides it. */
export function detectNerdFonts(env: NodeJS.ProcessEnv = process.env): boolean {
	if (env.POWERLINE_NERD_FONTS === "1" || env.LUMEN_NERD_FONTS === "1") return true;
	if (env.POWERLINE_NERD_FONTS === "0" || env.LUMEN_NERD_FONTS === "0") return false;
	if (env.GHOSTTY_RESOURCES_DIR) return true; // survives into tmux
	// TERM only when TERM_PROGRAM is unset (kitty uses TERM=xterm-kitty).
	const term = (env.TERM_PROGRAM ?? env.TERM ?? "").toLowerCase();
	return ["iterm", "wezterm", "kitty", "ghostty", "alacritty", "kaku"].some((t) => term.includes(t));
}

export function resolveIcons(mode: IconMode, env: NodeJS.ProcessEnv = process.env): "none" | "nerd" {
	if (mode === "auto") return detectNerdFonts(env) ? "nerd" : "none";
	return mode;
}
