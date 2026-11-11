import { basename } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { GitCounts } from "../git.ts";
import type { Quota } from "../quota.ts";
import { formatDuration } from "../time.ts";
import { cacheColor, contextColor, quotaColor, thinkingPaint } from "./colors.ts";

/** Everything a render needs, gathered by the caller so segments stay pure. */
export interface RenderData {
	theme: Theme;
	icons: "none" | "nerd";
	provider?: string;
	modelName?: string;
	thinkingLevel?: string;
	thinkingMs?: number;
	context?: { tokens: number | null; window: number; percent: number | null };
	spend: { mode: "api"; cost: number } | { mode: "oauth"; quota?: Quota; stale: boolean; cost?: number };
	cache: { kind: "hidden" } | { kind: "none" } | { kind: "rate"; percent: number };
	tps?: number;
	cwd: string;
	branch?: string | null;
	git?: GitCounts;
	extStatuses: string[];
}

export function formatTokens(n: number): string {
	if (n < 1000) return String(n);
	if (n < 1_000_000) return `${n >= 100_000 ? Math.round(n / 1000) : Math.round(n / 100) / 10}k`.replace(".0k", "k");
	return `${Math.round(n / 100_000) / 10}M`.replace(".0M", "M");
}

const ICON = { model: "󰧑 ", dir: " ", git: " " } as const;

export function modelSegment(d: RenderData, maxWidth?: number): string {
	const name = (d.modelName ?? "no-model").replace(/^Claude\s+/i, "");
	const icon = d.icons === "nerd" ? ICON.model : "";
	const full = `${icon}${d.provider ? `${d.provider} · ` : ""}${name}`;
	const text = maxWidth !== undefined ? truncateToWidth(full, Math.max(1, maxWidth), "…") : full;
	return d.theme.fg("accent", text);
}

export function thinkSegment(d: RenderData): string {
	const level = d.thinkingLevel ?? "off";
	let out = thinkingPaint(d.theme, level)(`think:${level}`);
	if (d.thinkingMs !== undefined && d.thinkingMs >= 1000) out += d.theme.fg("dim", ` ${formatDuration(d.thinkingMs)}`);
	return out;
}

export function contextSegment(d: RenderData): string {
	const c = d.context;
	if (!c) return d.theme.fg("dim", "?/?");
	const win = formatTokens(c.window);
	const used = c.tokens == null ? "?" : formatTokens(c.tokens);
	const text = `${used}/${win}${c.percent == null ? "" : ` ${Math.round(c.percent)}%`}`;
	return d.theme.fg(contextColor(c.percent), text);
}

export function spendSegment(d: RenderData): string | undefined {
	const s = d.spend;
	if (s.mode === "api") return d.theme.fg("muted", `$${s.cost.toFixed(s.cost < 10 ? 2 : 1)}`);
	if (s.quota && (s.quota.fiveHour !== undefined || s.quota.sevenDay !== undefined)) {
		const part = (label: string, v: number | undefined): string | undefined => {
			if (v === undefined) return undefined;
			return d.theme.fg(s.stale ? "dim" : quotaColor(v), `${label} ${v}%`);
		};
		return [part("5h", s.quota.fiveHour), part("7d", s.quota.sevenDay)].filter(Boolean).join(d.theme.fg("dim", " · "));
	}
	// OAuth without quota: reported cost if any, otherwise `sub`.
	return d.theme.fg("muted", s.cost && s.cost > 0 ? `$${s.cost.toFixed(2)}` : "sub");
}

export function cacheTpsSegment(d: RenderData): string | undefined {
	const parts: string[] = [];
	if (d.cache.kind === "rate") parts.push(d.theme.fg(cacheColor(d.cache.percent), `CH ${d.cache.percent}%`));
	else if (d.cache.kind === "none") parts.push(d.theme.fg("dim", "CH --"));
	if (d.cache.kind !== "hidden" || d.tps !== undefined) {
		parts.push(d.theme.fg("muted", d.tps === undefined ? "— tok/s" : `${Math.round(d.tps)} tok/s`));
	}
	return parts.length ? parts.join(d.theme.fg("dim", " · ")) : undefined;
}

export function dirSegment(d: RenderData): string {
	return d.theme.fg("muted", `${d.icons === "nerd" ? ICON.dir : ""}${basename(d.cwd) || d.cwd}`);
}

export function gitSegment(d: RenderData, withCounts: boolean): string | undefined {
	if (!d.branch) return undefined;
	const dirty = d.git && (d.git.unstaged || d.git.staged || d.git.untracked);
	const icon = d.icons === "nerd" ? ICON.git : "";
	let out = d.theme.fg(dirty ? "warning" : "success", `${icon}${d.branch}`);
	if (withCounts && d.git) {
		const c: string[] = [];
		if (d.git.unstaged) c.push(d.theme.fg("warning", `*${d.git.unstaged}`));
		if (d.git.staged) c.push(d.theme.fg("success", `+${d.git.staged}`));
		if (d.git.untracked) c.push(d.theme.fg("muted", `?${d.git.untracked}`));
		if (c.length) out += ` ${c.join(" ")}`;
	}
	return out;
}

export function extSegment(d: RenderData): string | undefined {
	const text = d.extStatuses
		.map((s) => s.replace(/[\r\n\t]+/g, " ").trim())
		.filter(Boolean)
		.join(" ");
	return text ? truncateToWidth(text, 32, "…") : undefined;
}
