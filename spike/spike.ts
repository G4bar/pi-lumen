// Throwaway M0 spike. Usage: pi -e ./spike/spike.ts   (then run /spike)
import { appendFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createReadToolDefinition } from "@earendil-works/pi-coding-agent";

const OUT = "/tmp/lumen-spike.log";
const log = (k: string, v: unknown) => appendFileSync(OUT, `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}\n`);

export default function (pi: ExtensionAPI) {
	writeFileSync(OUT, "");
	// SPIKE 10: does the spread definition carry promptSnippet/guidelines?
	const d = createReadToolDefinition(process.cwd());
	log("10.read.promptSnippet", d.promptSnippet ?? null);
	log("10.read.promptGuidelines", d.promptGuidelines ?? null);
	pi.registerTool({ ...d });

	let usageSamples: unknown[] = [];
	pi.on("message_update", (e) => {
		if (e.message.role !== "assistant") return;
		const ev = e.assistantMessageEvent as any;
		if (usageSamples.length < 400) usageSamples.push([ev.type, (e.message as any).usage?.output, (e.message as any).usage?.input]);
	});
	pi.on("message_end", (e) => {
		if (e.message.role !== "assistant") return;
		log("8.final.usage", (e.message as any).usage);
		log("8.samples(type,out,in) head", usageSamples.slice(0, 6));
		log("8.samples count", usageSamples.length);
		log("8.samples distinct outputs", [...new Set(usageSamples.map((s: any) => s[1]))]);
		usageSamples = [];
	});
	pi.on("before_agent_start", (e, ctx) => {
		const h = createHash("sha256").update(ctx.getSystemPrompt()).digest("hex");
		log("10.systemPrompt.sha256", h);
		log("10.systemPrompt.len", ctx.getSystemPrompt().length);
	});

	pi.on("session_start", async (_e, ctx) => {
		// SPIKE 16
		const s: any = pi.getSettings();
		log("16.settings.lumen", s.lumen ?? null);
		log("16.settings.keys", Object.keys(s));
		if (ctx.mode !== "tui") return;
		// SPIKE 1: empty footer + widget
		let footerData: any;
		ctx.ui.setFooter((_tui, _theme, fd) => {
			footerData = fd;
			return { render: () => [], invalidate() {} };
		});
		ctx.ui.setWidget("spike", (_tui, theme) => ({
			render: (w: number) => [theme.fg("accent", `SPIKE widget below w=${w} branch=${footerData?.getGitBranch()} ext=${JSON.stringify([...(footerData?.getExtensionStatuses?.() ?? [])])}`)],
			invalidate() {},
		}), { placement: "belowEditor" });
		ctx.ui.setStatus("spike-status", "hello-status");
	});

	pi.registerCommand("spike", {
		description: "Run M0 spikes",
		handler: async (_a, ctx) => {
			const m = ctx.model!;
			log("6.model", `${m.provider}/${m.id}`);
			log("6.isUsingOAuth", (ctx.modelRegistry as any).isUsingOAuth?.(m));
			try {
				const key = await (ctx.modelRegistry as any).getApiKeyForProvider?.("anthropic");
				log("6.getApiKeyForProvider", key ? { prefix: key.slice(0, 11), len: key.length } : null);
				if (key) {
					const r = await fetch("https://api.anthropic.com/api/oauth/usage", {
						headers: { Authorization: `Bearer ${key}`, "anthropic-beta": "oauth-2025-04-20", "User-Agent": "pi-lumen-spike" },
						signal: AbortSignal.timeout(5000),
					});
					log("6.usage.status", r.status);
					log("6.usage.body", (await r.text()).slice(0, 1500));
				}
			} catch (e) {
				log("6.error", String(e));
			}
			try {
				const auth = await (ctx.modelRegistry as any).getProviderAuth?.("anthropic");
				log("6.getProviderAuth.keys", auth ? Object.keys(auth) : null);
			} catch (e) {
				log("6.getProviderAuth.error", String(e));
			}
			log("1.thinkingLevel", ctx.thinkingLevel ?? null);
			log("1.theme.getThinkingBorderColor", typeof (ctx.ui.theme as any).getThinkingBorderColor);
			log("5.contextUsage", ctx.getContextUsage() ?? null);
			ctx.ui.notify("spike done, see /tmp/lumen-spike.log", "info");
		},
	});
}
