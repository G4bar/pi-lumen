/**
 * Thinking colors, multicolor effect and threshold colors.
 *
 * `rainbow()` follows nicobailon/pi-powerline-footer v0.22.0 (theme.ts), MIT, but is a smooth gradient through
 * pi's logo colors instead of powerline's per-character rainbow. Context thresholds (70/90 %) follow the same project.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { colorToRgb, mixColors, type RgbColorValue, rgbColor } from "@earendil-works/pi-tui";

type ThemeColor = Parameters<Theme["fg"]>[0];
export type Level = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** pi's logo colors, fixed across themes like the logo: coral, blue, yellow. */
const LOGO = [rgbColor(228, 138, 122), rgbColor(79, 142, 179), rgbColor(234, 182, 93)];

/**
 * Smooth loop through the logo colors: `t` in [0, 1) goes coral → blue → yellow → back to coral. Mixed in
 * OKLCH, so the steps in between stay vivid (pink/violet, then teal/green) instead of turning grey.
 */
function logoColorAt(t: number): string {
	const x = (((t % 1) + 1) % 1) * LOGO.length;
	const i = Math.floor(x);
	const { r, g, b } = colorToRgb(mixColors(LOGO[i] as RgbColorValue, LOGO[(i + 1) % LOGO.length] as RgbColorValue, x - i, "oklch"));
	return `\x1b[38;2;${Math.round(r)};${Math.round(g)};${Math.round(b)}m`;
}

/** One loop of the gradient across the text; spaces and colons are left uncolored. Resets only the foreground. */
export function rainbow(text: string): string {
	const chars = [...text];
	const n = chars.filter((ch) => ch !== " " && ch !== ":").length;
	let out = "";
	let i = 0;
	for (const ch of chars) {
		if (ch === " " || ch === ":") {
			out += ch;
		} else {
			out += logoColorAt(i / n) + ch;
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

/** Context usage: muted like the other neutral segments, warning above 70 %, error above 90 %; dim only when the usage is unknown. */
export function contextColor(percent: number | null | undefined): ThemeColor {
	if (percent == null) return "dim";
	if (percent > 90) return "error";
	return percent > 70 ? "warning" : "muted";
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

/** Braille turns per color loop: the color moves slower than the dots, which is easier on the eye. */
const TURNS_PER_LOOP = 3;

/** Working-indicator frames painted with the thinking level color (a slow logo gradient from `high` up). */
export function spinnerFrames(theme: Theme, level: string | undefined): string[] {
	const lv = level ?? "off";
	if (isRainbowLevel(lv)) {
		const n = BRAILLE.length * TURNS_PER_LOOP;
		return Array.from({ length: n }, (_, i) => `${logoColorAt(i / n)}${BRAILLE[i % BRAILLE.length]}\x1b[39m`);
	}
	const paint = thinkingPaint(theme, lv);
	return BRAILLE.map((ch) => paint(ch));
}
