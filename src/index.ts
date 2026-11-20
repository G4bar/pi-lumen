import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BOX_MODES, DEFAULTS, isBoxMode, isSpinnerName, type LumenConfig, SPINNER_NAMES, loadBootSettings, loadState, resolveConfig, statePath } from "./config.ts";
import { registerEmphasis } from "./emphasis.ts";
import { LumenSession } from "./session.ts";
import { registerStamp } from "./stamp.ts";
import { registerTools } from "./tools/index.ts";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** Config as known before any session exists (tool registration happens at load time). */
function bootConfig(): LumenConfig {
	try {
		const dir = getAgentDir();
		return resolveConfig(loadBootSettings(dir), loadState(statePath(dir)));
	} catch {
		return DEFAULTS;
	}
}

export default function lumen(pi: ExtensionAPI): void {
	let session: LumenSession | undefined;
	let cfg: LumenConfig = bootConfig();
	const getCfg = (): LumenConfig => session?.cfg ?? cfg;

	if (cfg.tools.enabled) registerTools(pi, getCfg);
	const stamp = registerStamp(pi, getCfg);
	const emphasis = registerEmphasis(pi, getCfg);

	pi.on("session_start", async (_e, ctx) => {
		session?.dispose();
		session = new LumenSession(pi, ctx);
		cfg = session.cfg;
		emphasis.start(ctx);
		stamp.restore(ctx.sessionManager.getEntries(), ctx.mode === "tui");
		session.installUi();
	});

	pi.on("session_shutdown", async () => {
		stamp.stop();
		emphasis.stop();
		session?.dispose();
		session = undefined;
	});

	pi.on("agent_start", (_e, ctx) => {
		session?.touch(ctx);
		session?.runStarted();
	});

	pi.on("message_update", (e, ctx) => {
		const s = session;
		if (!s || e.message.role !== "assistant") return;
		s.touch(ctx);
		const ev = e.assistantMessageEvent;
		switch (ev.type) {
			case "thinking_start":
				s.tps.begin();
				s.thinkingStart(e.message.timestamp);
				break;
			case "text_start":
			case "toolcall_start":
				s.tps.begin();
				break;
			case "thinking_delta":
				s.thinkingStart(e.message.timestamp);
				s.tps.delta(ev.delta);
				break;
			case "thinking_end":
				s.thinkingStop(e.message.timestamp);
				break;
			case "text_delta":
			case "toolcall_delta":
				s.tps.delta(ev.delta);
				break;
		}
		s.bump();
	});

	pi.on("message_end", (e, ctx) => {
		const s = session;
		if (!s) return;
		s.touch(ctx);
		if (e.message.role === "assistant") {
			if (s.thinking.running) s.thinkingStop(e.message.timestamp);
			s.tps.end(e.message.usage?.output);
		}
		s.markStatsDirty();
	});

	pi.on("turn_end", (_e, ctx) => {
		session?.touch(ctx);
		session?.markStatsDirty();
	});

	pi.on("agent_end", (_e, ctx) => {
		const s = session;
		if (!s) return;
		s.touch(ctx);
		s.invalidateGit();
		if (s.thinking.running) s.thinkingStop();
		s.markStatsDirty();
	});

	pi.on("tool_result", (e) => {
		session?.invalidateGit(); // any tool may touch the working tree (extensions, MCP, subagents)
	});

	pi.on("user_bash", () => {
		session?.refreshGitSoon();
	});

	pi.on("session_compact", (_e, ctx) => {
		session?.touch(ctx);
		session?.markStatsDirty();
	});

	pi.on("model_select", (_e, ctx) => {
		session?.touch(ctx);
		session?.applyWorkingIndicator();
		session?.markStatsDirty();
	});

	pi.on("thinking_level_select", (_e, ctx) => {
		session?.touch(ctx);
		session?.applyWorkingIndicator();
		session?.bump();
	});

	pi.registerCommand("status", {
		description: "pi-lumen: status of extensions (sync, LSP, …) and what is loaded",
		handler: async (_args, ctx) => {
			const s = session;
			if (!s) return;
			s.touch(ctx);
			ctx.ui.notify(s.statusReport(), "info");
		},
	});

	pi.registerCommand("lumen", {
		description: "pi-lumen: /lumen [placement above|below|toggle | box neutral|theme|none | spinner default|canadian|ogham|circle | emphasis on|off | on | off]",
		handler: async (args, ctx) => {
			const s = session;
			if (!s) return;
			s.touch(ctx);
			const [cmd, arg] = args.trim().split(/\s+/);
			if (cmd === "on" || cmd === "off") {
				s.setEnabled(cmd === "on");
			} else if (cmd === "placement") {
				const next = arg === "above" || arg === "below" ? arg : arg === "toggle" ? (s.cfg.placement === "below" ? "above" : "below") : undefined;
				if (!next) {
					ctx.ui.notify("Usage: /lumen placement above|below|toggle", "warning");
					return;
				}
				s.setPlacement(next);
			} else if (cmd === "box") {
				if (!isBoxMode(arg)) {
					ctx.ui.notify(`Usage: /lumen box ${BOX_MODES.join("|")} (now: ${s.cfg.tools.box})`, "warning");
					return;
				}
				s.setBox(arg);
			} else if (cmd === "spinner") {
				if (!isSpinnerName(arg)) {
					ctx.ui.notify(`Usage: /lumen spinner ${SPINNER_NAMES.join("|")} (now: ${s.cfg.spinner})`, "warning");
					return;
				}
				s.setSpinner(arg);
			} else if (cmd === "emphasis") {
				if (arg !== "on" && arg !== "off") {
					ctx.ui.notify(`Usage: /lumen emphasis on|off (now: ${s.cfg.emphasis.enabled ? "on" : "off"})`, "warning");
					return;
				}
				s.setEmphasis(arg === "on");
			} else if (cmd) {
				ctx.ui.notify("Usage: /lumen [placement above|below|toggle | box neutral|theme|none | spinner default|canadian|ogham|circle | emphasis on|off | on | off]", "warning");
				return;
			}
			ctx.ui.notify(s.describe(), "info");
		},
	});
}
