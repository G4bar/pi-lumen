import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type Placement = "above" | "below";

export interface LumenConfig {
	enabled: boolean;
	placement: Placement;
	separator: string;
	icons: "none" | "nerd";
	cache: "session";
	git: { statusTtlMs: number };
	quota: { enabled: boolean; ttlMs: number };
	stamp: { enabled: boolean; duration: boolean };
	tools: { enabled: boolean; previewLines: number };
	prompt: { icon: boolean };
	hiddenStatusKeys: string[];
}

export const DEFAULTS: LumenConfig = {
	enabled: true,
	placement: "below",
	separator: "│",
	icons: "none",
	cache: "session",
	git: { statusTtlMs: 2000 },
	quota: { enabled: true, ttlMs: 90_000 },
	stamp: { enabled: true, duration: false },
	tools: { enabled: true, previewLines: 40 },
	prompt: { icon: true },
	hiddenStatusKeys: [],
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Deep merge limited to keys present in `base`, keeping only values of the same primitive type. */
function merge<T>(base: T, over: unknown): T {
	if (!isRecord(over) || !isRecord(base)) return base;
	const out: Record<string, unknown> = { ...base };
	for (const [k, def] of Object.entries(base)) {
		const v = over[k];
		if (v === undefined) continue;
		if (isRecord(def)) out[k] = merge(def, v);
		else if (Array.isArray(def)) out[k] = Array.isArray(v) ? v.filter((x) => typeof x === "string") : def;
		else if (typeof v === typeof def) out[k] = v;
	}
	return out as T;
}

export function resolveConfig(settingsLumen: unknown, stateOverrides: unknown): LumenConfig {
	const cfg = merge(merge(DEFAULTS, settingsLumen), stateOverrides);
	if (cfg.placement !== "above" && cfg.placement !== "below") cfg.placement = DEFAULTS.placement;
	if (cfg.icons !== "none" && cfg.icons !== "nerd") cfg.icons = DEFAULTS.icons;
	cfg.tools.previewLines = Math.max(0, Math.floor(cfg.tools.previewLines));
	cfg.git.statusTtlMs = Math.max(250, cfg.git.statusTtlMs);
	cfg.quota.ttlMs = Math.max(15_000, cfg.quota.ttlMs);
	return cfg;
}

/** Persisted overrides written by `/lumen` commands (pi has no public settings writer). */
export type StateOverrides = Partial<Pick<LumenConfig, "enabled" | "placement">>;

export function statePath(agentDir: string): string {
	return join(agentDir, "pi-lumen.json");
}

export function loadState(path: string): StateOverrides {
	try {
		if (!existsSync(path)) return {};
		const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(raw)) return {};
		const out: StateOverrides = {};
		if (typeof raw.enabled === "boolean") out.enabled = raw.enabled;
		if (raw.placement === "above" || raw.placement === "below") out.placement = raw.placement;
		return out;
	} catch {
		return {};
	}
}

export function saveState(path: string, state: StateOverrides): void {
	try {
		mkdirSync(dirname(path), { recursive: true });
		const tmp = `${path}.${process.pid}.tmp`;
		writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
		renameSync(tmp, path);
	} catch {
		// Best effort: a read-only agent dir must never break the UI.
	}
}

type Obj = Record<string, unknown>;

function readLumenKey(path: string): Obj {
	try {
		const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
		const lumen = isRecord(raw) ? raw.lumen : undefined;
		return isRecord(lumen) ? lumen : {};
	} catch {
		return {};
	}
}

function deepAssign(a: Obj, b: Obj): Obj {
	const out: Obj = { ...a };
	for (const [k, v] of Object.entries(b)) {
		const cur = out[k];
		out[k] = isRecord(cur) && isRecord(v) ? deepAssign(cur, v) : v;
	}
	return out;
}

/**
 * `lumen` settings read straight from `<agentDir>/settings.json` and `<cwd>/.pi/settings.json`.
 * `pi.getSettings()` throws while extensions load, and tool renderers must be registered then.
 */
export function loadBootSettings(agentDir: string, cwd: string): Obj {
	return deepAssign(readLumenKey(join(agentDir, "settings.json")), readLumenKey(join(cwd, ".pi", "settings.json")));
}
