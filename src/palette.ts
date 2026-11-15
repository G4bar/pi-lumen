/**
 * pi's logo palette (`pi-logo.js` in pi-coding-agent). The brand colors stay fixed across themes, so the
 * start screen and the neutral parts of the status line paint them directly instead of theme tokens;
 * colors that carry meaning (thinking level, thresholds, git state) still come from the theme.
 */
import { foregroundAnsi, type RgbColorValue, rgbColor, type TerminalColorMode } from "@earendil-works/pi-tui";

export const CORAL = rgbColor(228, 138, 122);
export const BLUE = rgbColor(79, 142, 179);
export const YELLOW = rgbColor(234, 182, 93);

/** Anything with pi's `Theme.getColorMode`; test doubles without it get truecolor. */
export function colorMode(theme: { getColorMode?: () => TerminalColorMode } | undefined): TerminalColorMode {
	try {
		return theme?.getColorMode?.() ?? "truecolor";
	} catch {
		return "truecolor";
	}
}

/** Foreground-only paint (resets just the foreground, so surrounding backgrounds and bold survive). */
export function paint(color: RgbColorValue, text: string, mode: TerminalColorMode): string {
	return `${foregroundAnsi(color, mode)}${text}\x1b[39m`;
}
