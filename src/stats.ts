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

/**
 * Output tokens per second, from first content to message end.
 * While streaming the count is estimated as chars/4; `end()` replaces it with the exact figure.
 */
export class TpsTracker {
	private startedAt: number | undefined;
	private chars = 0;
	private last: number | undefined;

	constructor(private readonly now: () => number = Date.now) {}

	reset(): void {
		this.startedAt = undefined;
		this.chars = 0;
	}

	/** Feed a streamed delta (text, thinking or tool call arguments). */
	delta(text: string): void {
		if (this.startedAt === undefined) this.startedAt = this.now();
		this.chars += text.length;
	}

	/** Finish a message with the exact output token count. Returns tok/s or undefined. */
	end(outputTokens: number | undefined): number | undefined {
		if (this.startedAt !== undefined) {
			const secs = (this.now() - this.startedAt) / 1000;
			const tokens = outputTokens && outputTokens > 0 ? outputTokens : this.chars / 4;
			if (secs >= 0.25 && tokens > 0) this.last = tokens / secs;
		}
		this.reset();
		return this.last;
	}

	/** Live estimate while streaming, otherwise the last finished value. */
	current(): number | undefined {
		if (this.startedAt !== undefined) {
			const secs = (this.now() - this.startedAt) / 1000;
			if (secs >= 0.5 && this.chars > 0) return this.chars / 4 / secs;
			return this.last;
		}
		return this.last;
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
