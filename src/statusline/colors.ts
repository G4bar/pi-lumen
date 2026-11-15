/**
 * Thinking colors, multicolor effect and threshold colors.
 *
 * `rainbow()` follows nicobailon/pi-powerline-footer v0.22.0 (theme.ts), MIT, but cycles through pi's logo colors
 * instead of powerline's rainbow. Context thresholds (70/90 %) follow the same project.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";

type ThemeColor = Parameters<Theme["fg"]>[0];
export type Level = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** pi's logo colors: coral, blue, yellow (fixed across themes, like the logo). */
const RAINBOW = ["#e48a7a", "#4f8eb3", "#eab65d"];

function hexFg(hex: string): string {
	const h = hex.replace("#", "");
	return `\x1b[38;2;${Number.parseInt(h.slice(0, 2), 16)};${Number.parseInt(h.slice(2, 4), 16)};${Number.parseInt(h.slice(4, 6), 16)}m`;
}

/** Per-character gradient; spaces and colons are left uncolored. Resets only the foreground. */
export function rainbow(text: string): string {
	let out = "";
	let i = 0;
	for (const ch of text) {
		if (ch === " " || ch === ":") {
			out += ch;
		} else {
			out += hexFg(RAINBOW[i % RAINBOW.length] as string) + ch;
			i++;
		}
	}
	return `${out}\x1b[39m`;
}

/** `high`, `xhigh` and `max` are multicolor, in the logo colors (label and working spinner); lower levels use the theme. */
export function isRainbowLevel(level: string): boolean {
	return level === "high" || level === "xhigh" || level === "max";
}

/**
 * Colorize `text` for a thinking level: logo colors from `high` up, otherwise the very function pi uses for the
 * prompt box border (theme tokens `thinkingOff` … `thinkingMedium`). Falls back to `thinkingText` if the
 * theme helper is absent.
 */
export function thinkingPaint(theme: Theme, level: string | undefined): (text: string) => string {
	const lv = (level ?? "off") as Level;
	if (isRainbowLevel(lv)) return rainbow;
	const fn = (theme as { getThinkingBorderColor?: (l: Level) => (s: string) => string }).getThinkingBorderColor;
	if (typeof fn === "function") {
		try {
			return fn.call(theme, lv);
		} catch {
			/* fall through */
		}
	}
	return (t) => theme.fg("thinkingText", t);
}

/** Context usage: dim, warning above 70 %, error above 90 %. */
export function contextColor(percent: number | null | undefined): ThemeColor {
	if (percent == null) return "dim";
	if (percent > 90) return "error";
	return percent > 70 ? "warning" : "dim";
}

/** Quota usage: warning from 75 %, error from 90 %. */
export function quotaColor(percent: number): ThemeColor {
	if (percent >= 90) return "error";
	return percent >= 75 ? "warning" : "muted";
}

/** Cache hit-rate band: <30 error, <70 warning, otherwise success. */
export function cacheColor(percent: number): ThemeColor {
	if (percent < 30) return "error";
	return percent < 70 ? "warning" : "success";
}

const BRAILLE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Working-indicator frames painted with the thinking level color (the logo colors cycle per frame from `high` up). */
export function spinnerFrames(theme: Theme, level: string | undefined): string[] {
	const lv = level ?? "off";
	if (isRainbowLevel(lv)) return BRAILLE.map((ch, i) => `${hexFg(RAINBOW[i % RAINBOW.length] as string)}${ch}\x1b[39m`);
	const paint = thinkingPaint(theme, lv);
	return BRAILLE.map((ch) => paint(ch));
}
