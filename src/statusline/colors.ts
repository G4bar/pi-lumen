/**
 * Thinking colors and threshold colors. Context thresholds (70/90 %) and the cache bands follow
 * nicobailon/pi-powerline-footer v0.22.0 (MIT).
 */
import type { Theme } from "@earendil-works/pi-coding-agent";

type ThemeColor = Parameters<Theme["fg"]>[0];
export type Level = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Colorize `text` for a thinking level with the very function pi uses for the prompt box border, so the
 * label, the working spinner and the border always show the same color (set per level in the theme:
 * `thinkingOff` … `thinkingMax`). Falls back to `thinkingText` if the theme helper is absent.
 */
export function thinkingPaint(theme: Theme, level: string | undefined): (text: string) => string {
	const lv = (level ?? "off") as Level;
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

/** Working-indicator frames painted with the thinking level color (the prompt box border color). */
export function spinnerFrames(theme: Theme, level: string | undefined): string[] {
	const paint = thinkingPaint(theme, level ?? "off");
	return BRAILLE.map((ch) => paint(ch));
}
