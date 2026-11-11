import { describe, expect, it } from "vitest";
import { cacheView, computeStats, hitRatePercent, ThinkingTimer, TpsTracker } from "../src/stats.ts";

const usage = (o: Record<string, unknown> = {}) => ({ input: 10, output: 20, cacheRead: 0, cacheWrite: 0, cost: { total: 0.01 }, ...o });
const msg = (u: unknown, stopReason = "stop") => ({ type: "message", message: { role: "assistant", stopReason, usage: u } });

describe("computeStats", () => {
	it("sums messages, usage entries and compaction usage", () => {
		const s = computeStats([
			{ type: "message", message: { role: "user" } },
			msg(usage({ cacheRead: 80, cacheWrite: 10 })),
			{ type: "usage", kind: "cache_warm", usage: usage({ cost: { total: 0.5 } }) },
			{ type: "compaction", usage: usage({ cost: { total: 0.25 } }) },
			{ type: "garbage" },
			null,
		]);
		expect(s.cost).toBeCloseTo(0.01 + 0.5 + 0.25);
		expect(s.hasCost).toBe(true);
		expect(s.input).toBe(30);
		expect(s.output).toBe(60);
	});
	it("hasCost is false for zero-cost (subscription) usage", () => {
		const s = computeStats([msg(usage({ cost: { total: 0 } }))]);
		expect(s.hasCost).toBe(false);
	});
	it("ignores malformed usage", () => {
		expect(computeStats([msg({ foo: 1 }), msg(undefined)]).cost).toBe(0);
	});
	it("lastRequest resets on compaction and model_change, skips errors", () => {
		const base = [msg(usage({ cacheRead: 90 }))];
		expect(computeStats(base).lastRequest?.cacheRead).toBe(90);
		expect(computeStats([...base, { type: "compaction" }]).lastRequest).toBeUndefined();
		expect(computeStats([...base, { type: "model_change" }]).lastRequest).toBeUndefined();
		expect(computeStats([...base, msg(usage({ cacheRead: 1 }), "error")]).lastRequest?.cacheRead).toBe(90);
	});
});

describe("cache view", () => {
	it("hidden when never reported", () => {
		expect(cacheView(computeStats([msg(usage())]))).toEqual({ kind: "hidden" });
	});
	it("CH -- after a reset", () => {
		const s = computeStats([msg(usage({ cacheRead: 5 })), { type: "model_change" }]);
		expect(cacheView(s)).toEqual({ kind: "none" });
	});
	it("rate over prompt tokens of the last request", () => {
		const s = computeStats([msg(usage({ input: 10, cacheRead: 80, cacheWrite: 10 }))]);
		expect(cacheView(s)).toEqual({ kind: "rate", percent: 80 });
		expect(hitRatePercent({ input: 0, cacheRead: 0, cacheWrite: 0 })).toBeUndefined();
	});
});

describe("TpsTracker", () => {
	it("uses exact usage at end, window = first content → end", () => {
		let t = 1000;
		const tps = new TpsTracker(() => t);
		expect(tps.current()).toBeUndefined();
		t = 5000; // waiting time before first content must not count
		tps.delta("abcd".repeat(10));
		t = 7000;
		expect(tps.current()).toBeCloseTo(10 / 2 / 1, 5); // 40 chars/4 = 10 tok over 2s
		expect(tps.end(100)).toBeCloseTo(50);
		expect(tps.streaming).toBe(false);
		expect(tps.current()).toBeCloseTo(50);
	});
	it("keeps the last value when a run produces nothing", () => {
		let t = 0;
		const tps = new TpsTracker(() => t);
		tps.delta("x".repeat(40));
		t = 1000;
		tps.end(20);
		tps.reset();
		expect(tps.end(undefined)).toBeCloseTo(20);
	});
	it("ignores sub-250ms windows", () => {
		let t = 0;
		const tps = new TpsTracker(() => t);
		tps.delta("hi");
		t = 100;
		expect(tps.end(5)).toBeUndefined();
	});
	it("starts the clock at the *_start event, not at the first delta", () => {
		let t = 0;
		const tps = new TpsTracker(() => t);
		tps.begin();
		t = 1000;
		tps.delta("x".repeat(40));
		t = 2000;
		expect(tps.end(100)).toBeCloseTo(50); // 100 tok / 2s
	});
	it("live value follows a sliding window, not the whole-message average", () => {
		let t = 0;
		const tps = new TpsTracker(() => t, 2000);
		tps.begin();
		for (let i = 0; i < 10; i++) { // fast phase: 400 chars/s = 100 tok/s
			t += 1000;
			tps.delta("x".repeat(400));
		}
		expect(tps.current()).toBeCloseTo(100, 0); // 2s window = 200 tok / 2s
		for (let i = 0; i < 4; i++) { // slow phase: 40 chars/s = 10 tok/s
			t += 1000;
			tps.delta("x".repeat(40));
		}
		expect(tps.current()).toBeCloseTo(10, 0);
	});
	it("decays to 0 while the stream stalls", () => {
		let t = 0;
		const tps = new TpsTracker(() => t, 2000);
		tps.delta("x".repeat(400));
		t = 1000;
		tps.delta("x".repeat(400));
		t = 10_000;
		expect(tps.current()).toBe(0);
	});
	it("a burst flushed after a stall does not read as a spike", () => {
		let t = 0;
		const tps = new TpsTracker(() => t, 2000);
		tps.delta("x".repeat(80)); // 20 tok at t=0
		t = 5000;
		tps.delta("x".repeat(2000)); // 500 tok flushed at t=5000
		expect(tps.current()).toBeCloseTo(100, 0); // span extended back to t=0: 500 tok / 5s, not 250
		t = 5600;
		expect(tps.current()).toBeCloseTo(500 / 5.6, 0); // ~89, not 250
	});
	it("calibrates chars/token from the exact usage of finished messages", () => {
		let t = 0;
		const tps = new TpsTracker(() => t, 2000);
		tps.delta("x".repeat(300));
		t = 1000;
		tps.end(100); // 3 chars/token
		t = 5000;
		tps.delta("x".repeat(300));
		t = 6000;
		expect(tps.current()).toBeCloseTo(100); // 300 chars / 3 per token over 1s
	});
});

describe("ThinkingTimer", () => {
	it("accumulates blocks and resets", () => {
		let t = 0;
		const th = new ThinkingTimer(() => t);
		expect(th.elapsed()).toBeUndefined();
		th.start();
		t = 3000;
		expect(th.elapsed()).toBe(3000);
		expect(th.stop()).toBe(3000);
		t = 10_000;
		th.start();
		t = 12_000;
		expect(th.stop()).toBe(5000);
		expect(th.stop()).toBeUndefined();
		th.clear();
		expect(th.elapsed()).toBeUndefined();
	});
});
