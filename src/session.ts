import type { ExtensionAPI, ExtensionContext, ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { type LumenConfig, loadState, resolveConfig, type StateOverrides, saveState, statePath } from "./config.ts";
import { GitStatusCache } from "./git.ts";
import { QuotaClient } from "./quota.ts";
import { formatStatusReport, groupLoaded, type LoadedExtension } from "./status.ts";
import { RowThinking } from "./thinking-label.ts";
import { cacheView, computeStats, emptyStats, type LedgerStats, ThinkingTimer, TpsTracker } from "./stats.ts";

import { spinnerFrames } from "./statusline/colors.ts";
import { fitLine } from "./statusline/layout.ts";
import type { RenderData } from "./statusline/segments.ts";

const WIDGET_KEY = "pi-lumen";
const THROTTLE_MS = 250;
const STATS_MAX_AGE_MS = 5000;

/** Per-session state: owns every timer/process; `dispose()` is idempotent. */
export class LumenSession {
	cfg: LumenConfig;
	readonly tps = new TpsTracker();
	readonly thinking = new ThinkingTimer();
	private readonly rows = new RowThinking();
	private ctx: ExtensionContext;
	private tui: TUI | undefined;
	private footerData: ReadonlyFooterDataProvider | undefined;
	private stats: LedgerStats = emptyStats();
	private statsAt = 0;
	private statsDirty = true;
	private version = 0;
	private lastBump = 0;
	private throttle: ReturnType<typeof setTimeout> | undefined;
	private tick: ReturnType<typeof setInterval> | undefined;
	private disposed = false;
	private uiInstalled = false;
	/** False once pi disposed our footer because another extension installed its own. */
	private footerOwned = false;
	private lastLabel: string | undefined;
	private readonly git: GitStatusCache;
	private quota: QuotaClient | undefined;

	constructor(
		private readonly pi: ExtensionAPI,
		ctx: ExtensionContext,
	) {
		this.ctx = ctx;
		this.cfg = this.loadConfig();
		this.git = new GitStatusCache(
			() => this.cfg.git.statusTtlMs,
			() => this.bump(),
		);
	}

	loadConfig(): LumenConfig {
		let lumen: unknown;
		try {
			lumen = (this.pi.getSettings() as Record<string, unknown>).lumen;
		} catch {
			lumen = undefined;
		}
		return resolveConfig(lumen, loadState(statePath(getAgentDir())));
	}

	/** Keep the latest context: handlers receive a fresh one per event. */
	touch(ctx: ExtensionContext): void {
		if (!this.disposed) this.ctx = ctx;
	}

	// ── rendering ────────────────────────────────────────────────────────────

	/** Invalidate caches and request a render (throttled: leading edge + one trailing call). */
	bump(): void {
		if (this.disposed) return;
		this.version++;
		const now = Date.now();
		if (!this.throttle && now - this.lastBump >= THROTTLE_MS) {
			this.lastBump = now;
			this.tui?.requestRender();
		} else if (!this.throttle) {
			this.throttle = setTimeout(() => {
				this.throttle = undefined;
				this.lastBump = Date.now();
				if (!this.disposed) this.tui?.requestRender();
			}, THROTTLE_MS);
			this.throttle.unref?.();
		}
	}

	markStatsDirty(): void {
		this.statsDirty = true;
		this.bump();
	}

	private data(): RenderData {
		const ctx = this.ctx;
		if (this.statsDirty || Date.now() - this.statsAt > STATS_MAX_AGE_MS) {
			this.stats = computeStats(ctx.sessionManager.getEntries(), ctx.sessionManager.getBranch());
			this.statsAt = Date.now();
			this.statsDirty = false;
		}
		const model = ctx.model;
		let oauth = false;
		try {
			oauth = model ? ctx.modelRegistry.isUsingOAuth(model) : false;
		} catch {
			oauth = false;
		}
		let spend: RenderData["spend"];
		if (!oauth) {
			spend = { mode: "api", cost: this.stats.cost };
		} else {
			const quotaOn = this.cfg.quota.enabled && model?.provider === "anthropic";
			if (quotaOn) this.quotaClient().maybeRefresh();
			const peek = quotaOn ? this.quota?.peek() : undefined;
			spend = { mode: "oauth", quota: peek?.quota, stale: peek?.stale ?? false, cost: this.stats.hasCost ? this.stats.cost : undefined };
		}
		const usage = ctx.getContextUsage();
		const branch = this.footerData?.getGitBranch() ?? null;
		const inline = new Set(this.cfg.inlineStatusKeys);
		const ext = [...(this.footerData?.getExtensionStatuses() ?? [])].filter(([k]) => inline.has(k)).map(([, v]) => v);
		return {
			theme: ctx.ui.theme,
			icons: this.cfg.icons,
			provider: model?.provider,
			modelName: model?.name || model?.id,
			thinkingLevel: this.pi.getThinkingLevel(),
			context: usage ? { tokens: usage.tokens, window: usage.contextWindow, percent: usage.percent } : undefined,
			spend,
			cache: cacheView(this.stats),
			tps: this.tps.current(),
			cwd: ctx.cwd,
			branch,
			git: this.git.get(ctx.cwd, !!branch),
			extStatuses: ext,
		};
	}

	private quotaClient(): QuotaClient {
		this.quota ??= new QuotaClient({
			getToken: () => this.ctx.modelRegistry.getApiKeyForProvider("anthropic"),
			ttlMs: () => this.cfg.quota.ttlMs,
			onUpdate: () => this.bump(),
		});
		return this.quota;
	}

	/** Pure line for tests and the widget; never throws. */
	renderLine(width: number): string {
		try {
			return fitLine(this.data(), width, this.cfg.separator);
		} catch {
			return "";
		}
	}

	// ── UI installation ──────────────────────────────────────────────────────

	installUi(): void {
		const ctx = this.ctx;
		if (ctx.mode !== "tui" || this.uiInstalled || !this.cfg.enabled) return;
		this.uiInstalled = true;
		// The native footer is replaced by an empty component that only captures footerData.
		this.footerOwned = true;
		ctx.ui.setFooter((tui, _theme, fd) => {
			this.footerData = fd;
			this.tui ??= tui;
			const unsub = fd.onBranchChange(() => this.bump());
			return {
				render: () => [],
				invalidate() {},
				dispose: () => {
					unsub();
					this.footerOwned = false; // replaced (or removed): nothing left to restore
				},
			};
		});
		let cachedWidth = -1;
		let cachedVersion = -1;
		let cached: string[] = [];
		ctx.ui.setWidget(
			WIDGET_KEY,
			(tui) => {
				this.tui = tui;
				return {
					render: (width: number): string[] => {
						if (width !== cachedWidth || this.version !== cachedVersion) {
							cached = [this.renderLine(width)];
							cachedWidth = width;
							cachedVersion = this.version;
						}
						return cached;
					},
					invalidate() {
						cachedWidth = -1;
					},
					dispose: () => {
						if (this.tui === tui) this.tui = undefined;
					},
				};
			},
			{ placement: this.cfg.placement === "above" ? "aboveEditor" : "belowEditor" },
		);
		this.rows.install();
		this.applyWorkingIndicator();
		this.bump();
	}

	uninstallUi(): void {
		if (!this.uiInstalled) return;
		this.uiInstalled = false;
		try {
			this.ctx.ui.setWidget(WIDGET_KEY, undefined);
			if (this.footerOwned) this.ctx.ui.setFooter(undefined);
			this.footerOwned = false;
			this.lastLabel = undefined;
			this.ctx.ui.setWorkingIndicator();
			this.rows.dispose();
			this.ctx.ui.setHiddenThinkingLabel();
		} catch {
			/* context already torn down */
		}
		this.tui = undefined;
		this.footerData = undefined;
	}

	setPlacement(placement: LumenConfig["placement"]): void {
		this.cfg.placement = placement;
		this.persist();
		if (this.uiInstalled) {
			this.uninstallUi();
			this.installUi();
		}
	}

	setEnabled(enabled: boolean): void {
		this.cfg.enabled = enabled;
		this.persist();
		if (enabled) this.installUi();
		else this.uninstallUi();
	}

	private persist(): void {
		const state: StateOverrides = { enabled: this.cfg.enabled, placement: this.cfg.placement };
		saveState(statePath(getAgentDir()), state);
	}

	/** Full `/status` text: every extension status (not only the inline ones) plus the loaded extensions. */
	statusReport(): string {
		let statuses: ReadonlyMap<string, string> | undefined;
		let unavailable: string | undefined;
		try {
			statuses = this.footerData?.getExtensionStatuses();
		} catch {
			statuses = undefined;
		}
		if (!statuses) unavailable = this.ctx.mode !== "tui" ? "not available outside the TUI" : "pi-lumen is off: statuses are shown by pi's own footer";
		let loaded: LoadedExtension[] = [];
		try {
			loaded = groupLoaded(
				this.pi.getCommands().map((c) => ({ source: c.source, info: c.sourceInfo })),
				this.pi.getAllTools().map((t) => ({ info: t.sourceInfo })),
			);
		} catch {
			loaded = [];
		}
		return formatStatusReport({ statuses, unavailable, loaded, header: this.describe() });
	}

	describe(): string {
		const d = this.data();
		return `pi-lumen ${this.cfg.enabled ? "on" : "off"} · placement ${this.cfg.placement} · quota ${this.cfg.quota.enabled ? "on" : "off"} · tools ${this.cfg.tools.enabled ? "on" : "off"} · stamp ${this.cfg.stamp.enabled ? "on" : "off"} · ${d.provider ?? "?"}/${d.modelName ?? "?"}`;
	}

	// ── thinking & working indicator ─────────────────────────────────────────

	applyWorkingIndicator(): void {
		if (!this.uiInstalled) return;
		this.ctx.ui.setWorkingIndicator({ frames: spinnerFrames(this.ctx.ui.theme, this.pi.getThinkingLevel()), intervalMs: 90 });
	}

	private thinkingHidden(): boolean {
		try {
			return (this.pi.getSettings() as { hideThinkingBlock?: boolean }).hideThinkingBlock === true;
		} catch {
			return false;
		}
	}

	/** Push the per-row labels: pi's global label only triggers the fan-out (see thinking-label.ts). */
	private applyLabel(): void {
		if (!this.uiInstalled || !this.thinkingHidden()) return;
		const label = this.rows.globalLabel();
		if (label === this.lastLabel) return; // every call makes pi rebuild all assistant rows
		this.lastLabel = label;
		this.ctx.ui.setHiddenThinkingLabel(label);
	}

	thinkingStart(ts?: number): void {
		if (this.disposed) return;
		this.thinking.start();
		if (!this.uiInstalled) return; // print/json/rpc: no timer, no UI call
		if (ts !== undefined) this.rows.start(ts);
		this.applyLabel();
		this.tick ??= setInterval(() => {
			if (this.rows.running) this.applyLabel();
			this.bump();
		}, 1000);
		this.tick.unref?.();
	}

	thinkingStop(ts?: number): void {
		this.thinking.stop();
		this.rows.stop(ts);
		this.applyLabel();
		this.stopTick();
		this.bump();
	}

	private stopTick(): void {
		if (this.tick) clearInterval(this.tick);
		this.tick = undefined;
	}

	runStarted(): void {
		this.thinking.clear();
		this.tps.reset();
	}

	invalidateGit(): void {
		this.git.invalidate();
		this.bump();
	}

	dispose(): void {
		if (this.disposed) return;
		this.stopTick();
		if (this.throttle) clearTimeout(this.throttle);
		this.throttle = undefined;
		this.uninstallUi();
		this.disposed = true;
		this.git.dispose();
		this.quota?.dispose();
	}
}
