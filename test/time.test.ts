import { describe, expect, it } from "vitest";
import { formatClock, formatDay, formatDuration, formatStamp, formatToolDuration } from "../src/time.ts";

describe("formatDuration", () => {
	it("formats ms, s, m, h", () => {
		expect(formatDuration(850)).toBe("850ms");
		expect(formatDuration(12_400)).toBe("12s");
		expect(formatDuration(184_000)).toBe("3m 04s");
		expect(formatDuration(3_723_000)).toBe("1h 02m 03s");
		expect(formatDuration(-5)).toBe("0ms");
	});
	it("formats tool durations", () => {
		expect(formatToolDuration(5)).toBe("<0.01s");
		expect(formatToolDuration(20)).toBe("0.02s");
		expect(formatToolDuration(3100)).toBe("3.1s");
		expect(formatToolDuration(12_000)).toBe("12s");
		expect(formatToolDuration(64_000)).toBe("1m 04s");
	});
});

describe("stamps and time zones", () => {
	const ts = Date.UTC(2026, 0, 1, 23, 30, 5); // 23:30:05 UTC
	it("formats clock in a given zone", () => {
		expect(formatClock(ts, "UTC")).toBe("23:30:05");
		expect(formatClock(ts, "Europe/Rome")).toBe("00:30:05");
		expect(formatClock(ts, "America/New_York")).toBe("18:30:05");
	});
	it("day depends on the zone", () => {
		expect(formatDay(ts, "UTC")).toBe("2026-01-01");
		expect(formatDay(ts, "Europe/Rome")).toBe("2026-01-02");
	});
	it("midnight is 00:00:00, not 24", () => {
		expect(formatClock(Date.UTC(2026, 0, 1, 0, 0, 0), "UTC")).toBe("00:00:00");
	});
	it("shows the date only when the day changes", () => {
		const a = Date.UTC(2026, 0, 1, 10, 0, 0);
		const b = Date.UTC(2026, 0, 1, 11, 0, 0);
		const c = Date.UTC(2026, 0, 2, 9, 0, 0);
		expect(formatStamp(a, undefined, "UTC")).toBe("10:00:00");
		expect(formatStamp(b, a, "UTC")).toBe("11:00:00");
		expect(formatStamp(c, b, "UTC")).toBe("2026-01-02 · 09:00:00");
	});
	it("same instants cross midnight in Rome but not in UTC", () => {
		const a = Date.UTC(2026, 0, 1, 22, 30, 0);
		const b = Date.UTC(2026, 0, 1, 23, 30, 0);
		expect(formatStamp(b, a, "UTC")).toBe("23:30:00");
		expect(formatStamp(b, a, "Europe/Rome")).toBe("2026-01-02 · 00:30:00");
	});
});
