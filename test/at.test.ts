import { describe, expect, it, vi } from "vitest";
import { DEFAULTS, type LumenConfig } from "../src/config.ts";
import { atOf, formatAt, registerToolTimes, rowAt, showsTime } from "../src/tools/at.ts";

const cfg = (time: boolean, timeGapSec = 0): LumenConfig => ({ ...DEFAULTS, tools: { ...DEFAULTS.tools, time, timeGapSec } });

describe("tool row time", () => {
	it("reads the recorded time from details only when valid", () => {
		expect(atOf({ lumenAt: 123 })).toBe(123);
		expect(atOf({ lumenAt: "x" })).toBeUndefined();
		expect(atOf({ lumenAt: Number.NaN })).toBeUndefined();
		expect(atOf(undefined)).toBeUndefined();
		expect(atOf([1])).toBeUndefined();
	});

	it("formats the clock, with the date when it is not today", () => {
		const t = Date.UTC(2025, 0, 5, 14, 32, 7);
		expect(formatAt(t, t + 1000, "UTC")).toBe("14:32:07");
		expect(formatAt(t, t + 86_400_000, "UTC")).toBe("2025-01-05 14:32:07");
	});

	it("rowAt honours tools.time", () => {
		expect(rowAt(() => cfg(true), { lumenAt: 5 })).toBe(5);
		expect(rowAt(() => cfg(false), { lumenAt: 5 })).toBeUndefined();
	});

	it("showsTime: first time always, then only when far enough from the marker", () => {
		expect(showsTime(1000, undefined, 5000)).toBe(true);
		expect(showsTime(3000, 1000, 5000)).toBe(false);
		expect(showsTime(6000, 1000, 5000)).toBe(true);
		expect(showsTime(1000, 6000, 5000)).toBe(true); // results can arrive out of start order
		expect(showsTime(1000, 1000, 0)).toBe(true);
	});

	function harness(time: boolean, gap = 0) {
		const handlers: Record<string, (e: any) => unknown> = {};
		registerToolTimes({ on: (n: string, h: (e: any) => unknown) => void (handlers[n] = h) } as any, () => cfg(time, gap));
		return handlers;
	}

	it("stamps the start time into details, keeping the original details", () => {
		const h = harness(true);
		h.tool_execution_start?.({ toolCallId: "1", toolName: "bash" });
		const out = h.tool_result?.({ toolCallId: "1", toolName: "bash", details: { truncation: { truncated: true } } }) as { details: Record<string, unknown> };
		expect(out.details.truncation).toEqual({ truncated: true });
		expect(typeof out.details.lumenAt).toBe("number");
		const bare = h.tool_result?.({ toolCallId: "2", toolName: "edit", details: undefined }) as { details: Record<string, unknown> };
		expect(Object.keys(bare.details)).toEqual(["lumenAt"]);
	});

	it("leaves other tools, odd details and disabled config alone", () => {
		const h = harness(true);
		expect(h.tool_result?.({ toolCallId: "1", toolName: "grep", details: {} })).toBeUndefined();
		expect(h.tool_result?.({ toolCallId: "2", toolName: "bash", details: [1] })).toBeUndefined();
		expect(harness(false).tool_result?.({ toolCallId: "3", toolName: "bash", details: {} })).toBeUndefined();
	});

	it("with a gap, rows right after the run start get no time; the next far one does and moves the marker", () => {
		let now = 100_000;
		const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
		try {
			const h = harness(true, 5);
			h.agent_start?.({});
			const run = (id: string) => {
				h.tool_execution_start?.({ toolCallId: id, toolName: "bash" });
				return h.tool_result?.({ toolCallId: id, toolName: "bash", details: {} });
			};
			now += 1000;
			expect(run("a")).toBeUndefined();
			now += 9000;
			expect((run("b") as { details: Record<string, unknown> }).details.lumenAt).toBe(110_000);
			now += 2000;
			expect(run("c")).toBeUndefined();
		} finally {
			spy.mockRestore();
		}
	});
});
