/**
 * Anthropic 5h/7d quota from the UNOFFICIAL OAuth usage endpoint.
 *
 * Only used with an OAuth subscription (see index wiring). Cached, backed off exponentially
 * on failures, and the bearer token is never logged or stored.
 */

export const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

export interface Quota {
	fiveHour?: number;
	sevenDay?: number;
}

const pct = (bucket: unknown): number | undefined => {
	if (typeof bucket !== "object" || bucket === null) return undefined;
	const u = (bucket as Record<string, unknown>).utilization;
	return typeof u === "number" && Number.isFinite(u) ? Math.max(0, Math.min(100, Math.round(u))) : undefined;
};

/** Parse the response; any `null`/missing bucket is omitted. Returns undefined if no bucket is usable. */
export function parseQuota(json: unknown): Quota | undefined {
	if (typeof json !== "object" || json === null) return undefined;
	const o = json as Record<string, unknown>;
	const q: Quota = {};
	const five = pct(o.five_hour);
	const seven = pct(o.seven_day);
	if (five !== undefined) q.fiveHour = five;
	if (seven !== undefined) q.sevenDay = seven;
	return five === undefined && seven === undefined ? undefined : q;
}

export type Fetcher = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface QuotaOptions {
	getToken: () => Promise<string | undefined>;
	ttlMs: () => number;
	onUpdate: () => void;
	fetcher?: Fetcher;
	now?: () => number;
	timeoutMs?: number;
	maxBackoffMs?: number;
}

export class QuotaClient {
	private data: Quota | undefined;
	private fetchedAt = 0;
	private failures = 0;
	private nextAllowedAt = 0;
	private inflight = false;
	private disposed = false;
	private readonly fetcher: Fetcher;
	private readonly now: () => number;

	constructor(private readonly opts: QuotaOptions) {
		this.fetcher = opts.fetcher ?? ((url, init) => fetch(url, init));
		this.now = opts.now ?? Date.now;
	}

	/** Cached value; `stale` once older than 2x TTL or while backing off after a failure. */
	peek(): { quota: Quota; stale: boolean } | undefined {
		if (!this.data) return undefined;
		return { quota: this.data, stale: this.failures > 0 || this.now() - this.fetchedAt > this.opts.ttlMs() * 2 };
	}

	/** Start a background refresh when due. Never throws, never blocks. */
	maybeRefresh(): void {
		if (this.disposed || this.inflight) return;
		const t = this.now();
		if (t < this.nextAllowedAt) return;
		if (this.data && this.failures === 0 && t - this.fetchedAt < this.opts.ttlMs()) return;
		void this.refresh();
	}

	dispose(): void {
		this.disposed = true;
	}

	private async refresh(): Promise<void> {
		this.inflight = true;
		try {
			const token = await this.opts.getToken();
			if (!token) throw new Error("no token");
			const res = await this.fetcher(USAGE_URL, {
				headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20", "User-Agent": "pi-lumen" },
				signal: AbortSignal.timeout(this.opts.timeoutMs ?? 3000),
			});
			if (!res.ok) throw new Error(`http ${res.status}`);
			const quota = parseQuota(await res.json());
			if (!quota) throw new Error("bad shape");
			this.data = quota;
			this.failures = 0;
			this.fetchedAt = this.now();
			this.nextAllowedAt = 0;
		} catch {
			this.failures++;
			const base = Math.min(this.opts.maxBackoffMs ?? 600_000, this.opts.ttlMs() * 2 ** (this.failures - 1));
			this.nextAllowedAt = this.now() + base;
		} finally {
			this.inflight = false;
			if (!this.disposed) this.opts.onUpdate();
		}
	}
}
