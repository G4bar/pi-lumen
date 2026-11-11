/**
 * Transcript timestamps: a dim, right-aligned `HH:mm:ss` line per user message and per final
 * assistant message of a run. Stored with `appendEntry` (not sent to the model, but written to the
 * session file). Design follows narumiruna/pi-extensions › pi-stamp v0.54.1 (MIT): custom entry +
 * entry renderer, user stamps deferred because pi persists the user entry after `message_end`.
 */
import type { EntryRenderer, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import type { LumenConfig } from "./config.ts";
import { formatDuration, formatStamp } from "./time.ts";

export const STAMP_TYPE = "lumen-stamp";

export interface StampData {
	v: 1;
	role: "user" | "assistant";
	ts: number;
	prev?: number;
	/** Run duration in ms (assistant stamps, when `stamp.duration`). */
	dur?: number;
}

export function isStampData(d: unknown): d is StampData {
	if (typeof d !== "object" || d === null) return false;
	const o = d as Record<string, unknown>;
	return o.v === 1 && (o.role === "user" || o.role === "assistant") && typeof o.ts === "number" && Number.isFinite(o.ts);
}

export function stampLabel(d: StampData, timeZone?: string): string {
	const base = formatStamp(d.ts, d.prev, timeZone);
	return d.dur !== undefined && d.dur >= 0 ? `${base} · ${formatDuration(d.dur)}` : base;
}

const renderer: EntryRenderer<StampData> = (entry, _opts, theme) => {
	if (!isStampData(entry.data)) return undefined;
	const label = theme.fg("dim", stampLabel(entry.data));
	const c: Component = {
		render(width) {
			if (width < 1) return [];
			return [`${" ".repeat(Math.max(0, width - visibleWidth(label)))}${label}`];
		},
		invalidate() {},
	};
	return c;
};

export function registerStamp(pi: ExtensionAPI, getCfg: () => LumenConfig): { restore(entries: readonly unknown[], active: boolean): void; stop(): void } {
	pi.registerEntryRenderer(STAMP_TYPE, renderer);

	let active = false;
	let lastTs: number | undefined;
	let runStartedAt: number | undefined;
	const pendingUsers: number[] = [];

	const enabled = (): boolean => active && getCfg().stamp.enabled;
	const append = (role: StampData["role"], ts: number, dur?: number): void => {
		if (!Number.isFinite(ts)) return;
		const data: StampData = { v: 1, role, ts, ...(lastTs === undefined ? {} : { prev: lastTs }), ...(dur === undefined ? {} : { dur }) };
		pi.appendEntry<StampData>(STAMP_TYPE, data);
		lastTs = ts;
	};
	const flushUsers = (): void => {
		while (pendingUsers.length) {
			const ts = pendingUsers.shift() as number;
			if (enabled()) append("user", ts);
		}
	};

	pi.on("message_start", () => flushUsers());
	pi.on("message_end", (event) => {
		if (enabled() && event.message.role === "user") pendingUsers.push(event.message.timestamp);
	});
	pi.on("agent_start", () => {
		runStartedAt = Date.now();
	});
	pi.on("turn_end", (event) => {
		flushUsers();
		const m = event.message;
		if (!enabled() || m.role !== "assistant" || m.stopReason === "toolUse") return;
		const now = Date.now();
		append("assistant", now, getCfg().stamp.duration && runStartedAt !== undefined ? now - runStartedAt : undefined);
	});
	pi.on("agent_end", () => flushUsers());

	return {
		restore(entries, isTui) {
			active = isTui;
			lastTs = undefined;
			pendingUsers.length = 0;
			for (const e of entries) {
				const x = e as { type?: string; customType?: string; data?: unknown };
				if (x.type === "custom" && x.customType === STAMP_TYPE && isStampData(x.data)) lastTs = x.data.ts;
			}
		},
		stop() {
			flushUsers();
			pendingUsers.length = 0;
			active = false;
			runStartedAt = undefined;
		},
	};
}
