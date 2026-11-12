/**
 * Nerd Font icons for the status line.
 * Codepoints and the terminal heuristic come from nicobailon/pi-powerline-footer (icons.ts, MIT), which takes them
 * from oh-my-pi.
 */
import { execFileSync } from "node:child_process";

export type IconMode = "none" | "nerd" | "auto";

export const NERD = {
	model: "\u{F09D1} ", // nf-md glyph kept from the previous release
	dir: "\uF115 ", // nf-fa-folder_open
	git: "\uF126 ", // nf-fa-code_fork
	context: "\uF1C0 ", // nf-fa-database
	cost: "\uF155", // nf-fa-dollar
} as const;

/** Terminal-name heuristic (not a detection of the configured font); `POWERLINE_NERD_FONTS=1|0` overrides it. */
export function detectNerdFonts(env: NodeJS.ProcessEnv = process.env): boolean {
	if (env.POWERLINE_NERD_FONTS === "1" || env.LUMEN_NERD_FONTS === "1") return true;
	if (env.POWERLINE_NERD_FONTS === "0" || env.LUMEN_NERD_FONTS === "0") return false;
	if (env.GHOSTTY_RESOURCES_DIR) return true; // survives into tmux
	// TERM only when TERM_PROGRAM is unset (kitty uses TERM=xterm-kitty).
	const term = (env.TERM_PROGRAM ?? env.TERM ?? "").toLowerCase();
	return ["iterm", "wezterm", "kitty", "ghostty", "alacritty", "kaku"].some((t) => term.includes(t));
}

/** A Nerd Font installed on the system (`fc-list`), checked once. Only a hint: the terminal may use another font. */
let installed: boolean | undefined;
function hasInstalledNerdFont(): boolean {
	if (installed !== undefined) return installed;
	try {
		const out = execFileSync("fc-list", [":", "family"], { encoding: "utf8", timeout: 1500, stdio: ["ignore", "pipe", "ignore"] });
		installed = /nerd ?font/i.test(out);
	} catch {
		installed = false;
	}
	return installed;
}

export function resolveIcons(mode: IconMode, env: NodeJS.ProcessEnv = process.env, fonts: () => boolean = hasInstalledNerdFont): "none" | "nerd" {
	if (mode !== "auto") return mode;
	if (env.POWERLINE_NERD_FONTS === "0" || env.LUMEN_NERD_FONTS === "0") return "none";
	return detectNerdFonts(env) || fonts() ? "nerd" : "none";
}
