import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type Placement = "above" | "below";
/** Tool-box background (`tools.box`): `neutral` = pi's grey pending panel (red on errors), `theme` = pi's own panels, `none` = flat rows. */
export type BoxMode = "neutral" | "theme" | "none";
export const BOX_MODES: readonly BoxMode[] = ["neutral", "theme", "none"];
export const isBoxMode = (v: unknown): v is BoxMode => typeof v === "string" && (BOX_MODES as readonly string[]).includes(v);

/** Working spinner (`spinner`): `default` = braille dots; the others are sets from arkbig/throbber-widgets-tui. */
export type SpinnerName = "default" | "canadian" | "ogham" | "circle";
export const SPINNER_NAMES: readonly SpinnerName[] = ["default", "canadian", "ogham", "circle"];
export const isSpinnerName = (v: unknown): v is SpinnerName => typeof v === "string" && (SPINNER_NAMES as readonly string[]).includes(v);

export type EmphasisGuidance = "short" | "full" | "off";
export const EMPHASIS_GUIDANCE: readonly EmphasisGuidance[] = ["short", "full", "off"];

export interface LumenConfig {
	enabled: boolean;
	placement: Placement;
	spinner: SpinnerName;
	separator: string;
	icons: "ascii" | "none";
	cache: "session";
	git: { statusTtlMs: number };
	quota: { enabled: boolean; ttlMs: number };
	stamp: { enabled: boolean; duration: boolean };
	tools: { enabled: boolean; previewLines: number; changeLines: number; time: boolean; timeGapSec: number; shiki: boolean; theme: string; box: BoxMode };
	/** Status keys of other extensions still drawn in the status line; everything else is only in /status. */
	inlineStatusKeys: string[];
	/** Colored `[[Done]]` pills, icons and bold in assistant replies (display only), plus the prompt rules that teach the model to write them. */
	emphasis: { enabled: boolean; guidance: EmphasisGuidance; icons: boolean; color: string };
	/** Persistent start screen (boxed header with pi's logo) instead of pi's own header. */
	welcome: boolean;
}

export const DEFAULTS: LumenConfig = {
	enabled: true,
	placement: "below",
	spinner: "default",
	separator: "│",
	icons: "ascii",
	cache: "session",
	git: { statusTtlMs: 2000 },
	quota: { enabled: true, ttlMs: 90_000 },
	stamp: { enabled: true, duration: false },
	tools: { enabled: true, previewLines: 40, changeLines: 12, time: false, timeGapSec: 5, shiki: true, theme: "auto", box: "neutral" },
	inlineStatusKeys: [],
	emphasis: { enabled: false, guidance: "short", icons: true, color: "mdLink" },
	welcome: true,
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

const pickSpinner = (src: unknown, fallback: SpinnerName): SpinnerName => (isRecord(src) && isSpinnerName(src.spinner) ? src.spinner : fallback);

export function resolveConfig(settingsLumen: unknown, stateOverrides: unknown): LumenConfig {
	const fromSettings = merge(DEFAULTS, settingsLumen);
	const cfg = merge(fromSettings, stateOverrides);
	// `/lumen spinner` is saved as a top-level key of the state file and wins over settings.json; a bad value in either is ignored
	cfg.spinner = pickSpinner(stateOverrides, pickSpinner(settingsLumen, DEFAULTS.spinner));
	if (cfg.placement !== "above" && cfg.placement !== "below") cfg.placement = DEFAULTS.placement;
	if (cfg.icons !== "none" && cfg.icons !== "ascii") cfg.icons = DEFAULTS.icons;
	if (!(EMPHASIS_GUIDANCE as readonly string[]).includes(cfg.emphasis.guidance)) cfg.emphasis.guidance = DEFAULTS.emphasis.guidance;
	if (!cfg.emphasis.color.trim()) cfg.emphasis.color = DEFAULTS.emphasis.color;
	if (!isBoxMode(cfg.tools.box)) cfg.tools.box = DEFAULTS.tools.box;
	// `/lumen box` is saved as a top-level key of the state file and wins over settings.json
	if (isRecord(stateOverrides) && isBoxMode(stateOverrides.box)) cfg.tools.box = stateOverrides.box;
	// `/lumen emphasis on|off` is saved as a top-level key of the state file and wins over settings.json
	if (isRecord(stateOverrides) && typeof stateOverrides.emphasisEnabled === "boolean") cfg.emphasis.enabled = stateOverrides.emphasisEnabled;
	cfg.tools.previewLines = Math.max(0, Math.floor(cfg.tools.previewLines));
	cfg.tools.changeLines = Math.max(0, Math.floor(cfg.tools.changeLines));
	cfg.tools.timeGapSec = Math.max(0, cfg.tools.timeGapSec);
	cfg.git.statusTtlMs = Math.max(250, cfg.git.statusTtlMs);
	cfg.quota.ttlMs = Math.max(15_000, cfg.quota.ttlMs);
	return cfg;
}

/** Persisted overrides written by `/lumen` commands (pi has no public settings writer). */
export type StateOverrides = Partial<Pick<LumenConfig, "enabled" | "placement">> & { box?: BoxMode; spinner?: SpinnerName; emphasisEnabled?: boolean };

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
		if (isBoxMode(raw.box)) out.box = raw.box;
		if (isSpinnerName(raw.spinner)) out.spinner = raw.spinner;
		if (typeof raw.emphasisEnabled === "boolean") out.emphasisEnabled = raw.emphasisEnabled;
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

/**
 * `lumen` settings read straight from `<agentDir>/settings.json`.
 * `pi.getSettings()` throws while extensions load, and tool renderers must be registered then.
 * Project settings are deliberately not read here: at load time pi's trust decision for the project is not
 * known to extensions. Once a session exists, `pi.getSettings()` supplies the (trust-aware) merged values,
 * so only load-time switches such as `tools.enabled` are global-only.
 */
export function loadBootSettings(agentDir: string): Obj {
	return readLumenKey(join(agentDir, "settings.json"));
}
