import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { cacheTpsSegment, contextSegment, dirSegment, extSegment, gitSegment, modelSegment, type RenderData, spendSegment, thinkSegment } from "./segments.ts";

/**
 * Drop order when the line does not fit (first dropped first):
 * 1 ext → 2 dir → 3 cache_tps → 4 spend → 5 git counters → 6 git branch.
 * model, think and context always stay. The git branch and its counters go last: they are what you glance at.
 */
export const MAX_LEVEL = 6;

export function buildLine(d: RenderData, level: number, separator: string, modelMax?: number): string {
	const sep = ` ${d.theme.fg("dim", separator)} `;
	const segs: Array<string | undefined> = [
		modelSegment(d, modelMax),
		thinkSegment(d),
		contextSegment(d),
		level < 4 ? spendSegment(d) : undefined,
		level < 3 ? cacheTpsSegment(d) : undefined,
		level < 2 ? dirSegment(d) : undefined,
		level < 6 ? gitSegment(d, level < 5) : undefined,
		level < 1 ? extSegment(d) : undefined,
	];
	return segs.filter((s): s is string => typeof s === "string" && s.length > 0).join(sep);
}

/** Single line that never exceeds `width`. */
export function fitLine(d: RenderData, width: number, separator = "│"): string {
	if (width < 1) return "";
	for (let level = 0; level <= MAX_LEVEL; level++) {
		const line = buildLine(d, level, separator);
		if (visibleWidth(line) <= width) return line;
	}
	// Everything else is gone: shrink the model name, then hard truncate.
	const rest = visibleWidth(buildLine({ ...d, modelName: "", provider: "" }, MAX_LEVEL, separator));
	const room = width - rest;
	if (room >= 6) {
		const line = buildLine(d, MAX_LEVEL, separator, room);
		if (visibleWidth(line) <= width) return line;
	}
	return truncateToWidth(buildLine(d, MAX_LEVEL, separator), width, "…");
}
