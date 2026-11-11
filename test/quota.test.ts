import { describe, expect, it, vi } from "vitest";
import { type Fetcher, parseQuota, QuotaClient } from "../src/quota.ts";

describe("parseQuota", () => {
	it("parses the real response shape", () => {
		const body = { five_hour: { utilization: 57.0, resets_at: "x" }, seven_day: { utilization: 4.0 }, seven_day_opus: null, limits: [] };
		expect(parseQuota(body)).toEqual({ fiveHour: 57, sevenDay: 4 });
	});
	it("omits null buckets", () => {
		expect(parseQuota({ five_hour: { utilization: 10 }, seven_day: null })).toEqual({ fiveHour: 10 });
		expect(parseQuota({ five_hour: null, seven_day: { utilization: 99.6 } })).toEqual({ sevenDay: 100 });
	});
	it("rejects unusable payloads", () => {
		expect(parseQuota(null)).toBeUndefined();
		expect(parseQuota({ five_hour: null, seven_day: null })).toBeUndefined();
		expect(parseQuota({ five_hour: { utilization: "a" } })).toBeUndefined();
		expect(parseQuota("x")).toBeUndefined();
	});
	it("clamps to 0–100", () => {
		expect(parseQuota({ five_hour: { utilization: 250 }, seven_day: { utilization: -3 } })).toEqual({ fiveHour: 100, sevenDay: 0 });
	});
});

describe("QuotaClient", () => {
	const flush = () => new Promise((r) => setTimeout(r, 0));
	const ok = (json: unknown): Fetcher => async () => ({ ok: true, status: 200, json: async () => json });
	const make = (fetcher: Fetcher, nowRef: { t: number }, token: string | null = "tok") =>
		new QuotaClient({ getToken: async () => token ?? undefined, ttlMs: () => 90_000, onUpdate: () => {}, fetcher, now: () => nowRef.t });

	it("fetches, caches for TTL, and sends the bearer without leaking it", async () => {
		const now = { t: 1000 };
		const f = vi.fn(ok({ five_hour: { utilization: 37 }, seven_day: { utilization: 12 } }));
		const q = make(f, now);
		q.maybeRefresh();
		await flush();
		expect(q.peek()).toEqual({ quota: { fiveHour: 37, sevenDay: 12 }, stale: false });
		expect(f.mock.calls[0]?.[1].headers.Authorization).toBe("Bearer tok");
		q.maybeRefresh();
		await flush();
		expect(f).toHaveBeenCalledTimes(1);
		now.t += 91_000;
		q.maybeRefresh();
		await flush();
		expect(f).toHaveBeenCalledTimes(2);
	});

	it("backs off exponentially after failures, keeps stale data, recovers", async () => {
		const now = { t: 0 };
		let fail = false;
		const f = vi.fn<Fetcher>(async () => (fail ? { ok: false, status: 429, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ five_hour: { utilization: 5 } }) }));
		const q = make(f, now);
		q.maybeRefresh();
		await flush();
		fail = true;
		now.t += 100_000;
		q.maybeRefresh(); // failure 1 → wait 90s
		await flush();
		expect(q.peek()?.stale).toBe(true);
		expect(q.peek()?.quota).toEqual({ fiveHour: 5 });
		now.t += 10_000;
		q.maybeRefresh();
		await flush();
		expect(f).toHaveBeenCalledTimes(2); // still backing off
		now.t += 90_000;
		q.maybeRefresh(); // failure 2 → wait 180s
		await flush();
		now.t += 100_000;
		q.maybeRefresh();
		await flush();
		expect(f).toHaveBeenCalledTimes(3);
		fail = false;
		now.t += 200_000;
		q.maybeRefresh();
		await flush();
		expect(q.peek()?.stale).toBe(false);
	});

	it("caps backoff at 10 minutes", async () => {
		const now = { t: 0 };
		const f = vi.fn<Fetcher>(async () => ({ ok: false, status: 500, json: async () => ({}) }));
		const q = make(f, now);
		for (let i = 0; i < 12; i++) {
			q.maybeRefresh();
			await flush();
			now.t += 600_001;
		}
		expect(f).toHaveBeenCalledTimes(12);
	});

	it("no token → no network, no throw", async () => {
		const f = vi.fn(ok({}));
		const q = make(f, { t: 0 }, null);
		q.maybeRefresh();
		await flush();
		expect(f).not.toHaveBeenCalled();
		expect(q.peek()).toBeUndefined();
	});

	it("fetch rejection is swallowed; dispose stops work", async () => {
		const now = { t: 0 };
		const q = make(async () => {
			throw new Error("net");
		}, now);
		q.maybeRefresh();
		await flush();
		expect(q.peek()).toBeUndefined();
		q.dispose();
		const f = vi.fn(ok({ five_hour: { utilization: 1 } }));
		const q2 = make(f, now);
		q2.dispose();
		q2.maybeRefresh();
		expect(f).not.toHaveBeenCalled();
	});
});
