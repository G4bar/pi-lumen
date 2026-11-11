/**
 * Time helpers.
 *
 * `formatDuration` is ported from `formatThinkingDuration` in
 * heyhuynhgiabuu/pi-pretty v0.10.0 (src/working-indicator.ts), MIT.
 */

/** `850ms`, `12s`, `3m 04s`, `1h 02m 03s`. */
export function formatDuration(elapsedMs: number): string {
	const wholeMs = Math.max(0, Math.floor(elapsedMs));
	if (wholeMs < 1000) return `${wholeMs}ms`;
	const totalSeconds = Math.floor(wholeMs / 1000);
	const seconds = totalSeconds % 60;
	const totalMinutes = Math.floor(totalSeconds / 60);
	const minutes = totalMinutes % 60;
	const hours = Math.floor(totalMinutes / 60);
	const pad = (n: number) => String(n).padStart(2, "0");
	if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
	if (totalMinutes > 0) return `${totalMinutes}m ${pad(seconds)}s`;
	return `${seconds}s`;
}

/** Tool durations: `0.02s`, `3.1s`, `1m 04s`. */
export function formatToolDuration(ms: number): string {
	if (ms < 10) return "<0.01s";
	if (ms < 60_000) return `${(Math.max(0, ms) / 1000).toFixed(ms < 10_000 ? (ms < 1000 ? 2 : 1) : 0)}s`;
	return formatDuration(ms);
}

function parts(ts: number, timeZone?: string): Record<string, string> {
	const fmt = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	});
	const out: Record<string, string> = {};
	for (const p of fmt.formatToParts(ts)) out[p.type] = p.value;
	return out;
}

/** `HH:mm:ss` in the given IANA zone (default: local). */
export function formatClock(ts: number, timeZone?: string): string {
	const p = parts(ts, timeZone);
	return `${p.hour}:${p.minute}:${p.second}`;
}

/** `YYYY-MM-DD` in the given IANA zone (default: local). */
export function formatDay(ts: number, timeZone?: string): string {
	const p = parts(ts, timeZone);
	return `${p.year}-${p.month}-${p.day}`;
}

/** Stamp label: date prefix only when the day differs from the previous stamp. */
export function formatStamp(ts: number, prevTs: number | undefined, timeZone?: string): string {
	const clock = formatClock(ts, timeZone);
	if (prevTs === undefined || formatDay(prevTs, timeZone) !== formatDay(ts, timeZone)) {
		// First stamp ever, or a new day: show the date.
		return prevTs === undefined ? clock : `${formatDay(ts, timeZone)} · ${clock}`;
	}
	return clock;
}
