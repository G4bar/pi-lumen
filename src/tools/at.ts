/**
 * Wall-clock time of tool rows. The start time is written into the tool result's `details`
 * (`lumenAt`), so it is persisted with the result by pi itself: no extra session entries, never sent to
 * the model, and still there after a resume. Results stored before this existed simply show no time.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LumenConfig } from "../config.ts";
import { formatClock, formatDay } from "../time.ts";

export const AT_KEY = "lumenAt";
/** Tools whose rows pi-lumen renders (the only ones that can show the time). */
export const TIMED_TOOLS: ReadonlySet<string> = new Set(["read", "bash", "edit", "write"]);
const MAX_PENDING = 256;

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The recorded start time of a result, if any. */
export function atOf(details: unknown): number | undefined {
	if (!isPlain(details)) return undefined;
	const v = details[AT_KEY];
	return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** `14:32:07`, prefixed with the date when it is not today. */
export function formatAt(ts: number, now = Date.now(), timeZone?: string): string {
	const clock = formatClock(ts, timeZone);
	return formatDay(ts, timeZone) === formatDay(now, timeZone) ? clock : `${formatDay(ts, timeZone)} ${clock}`;
}

/** The time to show on a result row, honouring `tools.time`. */
export function rowAt(getCfg: () => LumenConfig, details: unknown): number | undefined {
	return getCfg().tools.time ? atOf(details) : undefined;
}

/**
 * Whether a tool started at `at` deserves its own clock time: only when it is at least `gapMs` away from the last
 * visible time (the run start, which carries the user stamp, or the previous visible tool). Fast runs therefore show
 * no repeated `18:56:28`; long ones keep a timeline.
 */
export function showsTime(at: number, marker: number | undefined, gapMs: number): boolean {
	return marker === undefined || Math.abs(at - marker) >= gapMs;
}

export function registerToolTimes(pi: ExtensionAPI, getCfg: () => LumenConfig): void {
	const started = new Map<string, number>();
	let marker: number | undefined;
	pi.on("agent_start", () => {
		marker = Date.now();
	});
	pi.on("tool_execution_start", (e) => {
		if (!TIMED_TOOLS.has(e.toolName)) return;
		if (started.size >= MAX_PENDING) started.delete(started.keys().next().value as string);
		started.set(e.toolCallId, Date.now());
	});
	pi.on("tool_result", (e) => {
		const at = started.get(e.toolCallId) ?? Date.now();
		started.delete(e.toolCallId);
		if (!getCfg().tools.time || !TIMED_TOOLS.has(e.toolName)) return undefined;
		const details: unknown = e.details;
		if (details !== undefined && !isPlain(details)) return undefined; // never reshape unknown details
		if (!showsTime(at, marker, getCfg().tools.timeGapSec * 1000)) return undefined;
		marker = at;
		return { details: { ...details, [AT_KEY]: at } };
	});
}
