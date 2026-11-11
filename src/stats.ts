/**
 * Session ledger: cost, cache hit-rate, token counts and TPS.
 *
 * Cache hit-rate formula and band thresholds (<30 red, <70 yellow, else green) follow
 * nicobailon/pi-powerline-footer v0.22.0 (segments.ts `hitRatePercent`), MIT.
 */

export interface UsageLike {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost?: { total?: number };
}

export interface LedgerStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** Sum of `usage.cost.total` over messages, usage entries and compactions. */
	cost: number;
	/** True when at least one usage reported a non-zero cost. */
	hasCost: boolean;
	/** Cache usage of the latest request since the prompt last changed shape (compaction / model change). */
	lastRequest?: { input: number; cacheRead: number; cacheWrite: number };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function asUsage(v: unknown): UsageLike | undefined {
	if (typeof v !== "object" || v === null) return undefined;
	const u = v as Record<string, unknown>;
	if (typeof u.input !== "number" || typeof u.output !== "number") return undefined;
	return {
		input: num(u.input),
		output: num(u.output),
		cacheRead: num(u.cacheRead),
		cacheWrite: num(u.cacheWrite),
		cost: { total: num((u.cost as Record<string, unknown> | undefined)?.total) },
	};
}

export function emptyStats(): LedgerStats {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, hasCost: false };
}

/** Fold a list of session entries (any shape) into ledger stats. Unknown entries are ignored. */
export function computeStats(entries: readonly unknown[]): LedgerStats {
	const s = emptyStats();
	const add = (u: UsageLike | undefined): void => {
		if (!u) return;
		s.input += u.input;
		s.output += u.output;
		s.cacheRead += u.cacheRead;
		s.cacheWrite += u.cacheWrite;
		const c = u.cost?.total ?? 0;
		s.cost += c;
		if (c > 0) s.hasCost = true;
	};
	for (const e of entries) {
		if (typeof e !== "object" || e === null) continue;
		const entry = e as Record<string, unknown>;
		switch (entry.type) {
			case "message": {
				const m = entry.message as Record<string, unknown> | undefined;
				if (m?.role !== "assistant") break;
				const u = asUsage(m.usage);
				add(u);
				if (u && m.stopReason !== "error" && m.stopReason !== "aborted" && u.input + u.cacheRead + u.cacheWrite + u.output > 0) {
					s.lastRequest = { input: u.input, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite };
				}
				break;
			}
			case "usage":
			case "compaction":
				add(asUsage(entry.usage));
				if (entry.type === "compaction") s.lastRequest = undefined;
				break;
			case "model_change":
				s.lastRequest = undefined;
				break;
			default:
				break;
		}
	}
	return s;
}

/** Whole-percent hit rate over prompt tokens, or undefined when there were none. */
export function hitRatePercent(t: { input: number; cacheRead: number; cacheWrite: number }): number | undefined {
	const prompt = t.input + t.cacheRead + t.cacheWrite;
	return prompt > 0 ? Math.round((t.cacheRead / prompt) * 100) : undefined;
}

export type CacheView = { kind: "hidden" } | { kind: "none" } | { kind: "rate"; percent: number };

/** `hidden` if the provider never reported cache; `none` (`CH --`) if the latest request had none. */
export function cacheView(s: LedgerStats): CacheView {
	if (s.cacheRead + s.cacheWrite === 0) return { kind: "hidden" };
	const last = s.lastRequest;
	if (!last || last.cacheRead + last.cacheWrite === 0) return { kind: "none" };
	const percent = hitRatePercent(last);
	return percent === undefined ? { kind: "none" } : { kind: "rate", percent };
}

/** Width of the live sliding window, in ms. */
export const TPS_WINDOW_MS = 2000;
/** Below this span the live rate is too noisy to show. */
const TPS_MIN_SPAN_MS = 500;
/** Finished messages shorter than this are ignored (usually a single flush). */
const TPS_MIN_FINAL_MS = 250;
const DEFAULT_CHARS_PER_TOKEN = 4;

/**
 * Output tokens per second.
 *
 * - Clock starts at the first content event (`*_start` or delta), never at the request, so the
 *   time-to-first-token is excluded.
 * - Live value: sliding window over the last {@link TPS_WINDOW_MS} (clipped to the stream start), so it
 *   follows the current speed and decays during stalls instead of averaging the whole message.
 *   Tokens are estimated from chars using a chars/token ratio calibrated on the exact usage of the
 *   previous messages (4 until the first one finishes).
 * - Final value: provider-reported `usage.output` over first content → message end.
 *
 * Inspired by gsanhueza/pi-token-speed (sliding window, TTFT excluded, reconcile with usage at end).
 */
export class TpsTracker {
	private startedAt: number | undefined;
	private chars = 0;
	private events: { t: number; chars: number }[] = [];
	/** Timestamp of the latest event that fell out of the window (the one before a possible burst). */
	private prunedT: number | undefined;
	private charsPerToken = DEFAULT_CHARS_PER_TOKEN;
	private last: number | undefined;

	constructor(
		private readonly now: () => number = Date.now,
		private readonly windowMs: number = TPS_WINDOW_MS,
	) {}

	reset(): void {
		this.startedAt = undefined;
		this.chars = 0;
		this.events = [];
		this.prunedT = undefined;
	}

	/** Mark the first content event (text/thinking/tool call start). Idempotent. */
	begin(): void {
		this.startedAt ??= this.now();
	}

	/** Feed a streamed delta (text, thinking or tool call arguments). */
	delta(text: string): void {
		const t = this.now();
		this.startedAt ??= t;
		if (text.length === 0) return;
		this.chars += text.length;
		this.events.push({ t, chars: text.length });
		const cutoff = t - this.windowMs;
		let drop = 0;
		let lastDropped: number | undefined;
		for (const e of this.events) {
			if (e.t >= cutoff) break;
			lastDropped = e.t;
			drop++;
		}
		if (drop > 0) {
			this.prunedT = lastDropped;
			this.events.splice(0, drop);
		}
	}

	/** Finish a message with the exact output token count. Returns tok/s or undefined. */
	end(outputTokens: number | undefined): number | undefined {
		if (this.startedAt !== undefined) {
			const ms = this.now() - this.startedAt;
			const exact = typeof outputTokens === "number" && Number.isFinite(outputTokens) && outputTokens > 0;
			const tokens = exact ? outputTokens : this.chars / this.charsPerToken;
			if (ms >= TPS_MIN_FINAL_MS && tokens > 0) this.last = (tokens * 1000) / ms;
			// Calibrate the live estimator (clamped: hidden reasoning tokens would skew it).
			if (exact && this.chars > 0) this.charsPerToken = Math.min(6, Math.max(2, this.chars / outputTokens));
		}
		this.reset();
		return this.last;
	}

	/** Sliding-window estimate while streaming, otherwise the last finished value. */
	current(): number | undefined {
		if (this.startedAt === undefined) return this.last;
		const now = this.now();
		let from = Math.max(this.startedAt, now - this.windowMs);
		// Burst after a stall (provider buffered, then flushed everything at one timestamp): extend the span back
		// to the last event before the burst, otherwise the flush would read as a huge spike.
		const first = this.events[0];
		if (this.prunedT !== undefined && first && this.events.every((e) => e.t === first.t)) from = Math.max(this.startedAt, this.prunedT);
		const span = now - from;
		if (span < TPS_MIN_SPAN_MS) return this.last;
		let chars = 0;
		// An event exactly on the window edge belongs to the previous interval, unless the window starts at the stream start.
		for (const e of this.events) if (e.t > from || (from === this.startedAt && e.t === from)) chars += e.chars;
		if (chars === 0) return this.events.length === 0 && this.chars === 0 ? this.last : 0;
		return (chars / this.charsPerToken / span) * 1000;
	}

	get streaming(): boolean {
		return this.startedAt !== undefined;
	}
}

/** Accumulates thinking time across the blocks of one run (reset with `clear()` at run start). */
export class ThinkingTimer {
	private startedAt: number | undefined;
	private totalMs = 0;
	private any = false;

	constructor(private readonly now: () => number = Date.now) {}

	start(): void {
		if (this.startedAt === undefined) {
			this.startedAt = this.now();
			this.any = true;
		}
	}

	/** Stop the current block; returns the accumulated total, or undefined if not running. */
	stop(): number | undefined {
		if (this.startedAt === undefined) return undefined;
		this.totalMs += this.now() - this.startedAt;
		this.startedAt = undefined;
		return this.totalMs;
	}

	get running(): boolean {
		return this.startedAt !== undefined;
	}

	/** Accumulated time including the running block; undefined if nothing was thought yet. */
	elapsed(): number | undefined {
		if (!this.any) return undefined;
		return this.totalMs + (this.startedAt === undefined ? 0 : this.now() - this.startedAt);
	}

	clear(): void {
		this.startedAt = undefined;
		this.totalMs = 0;
		this.any = false;
	}
}
