import { describe, expect, it } from "vitest";
import { hasPi, hasTmux, useSession } from "./harness.ts";

const PUA = /[\ue000-\uf8ff]/u;
const REPLY = [
	"## Finding",
	"**Cause:** the cache was stale. [[Failed: 3 tests]] [[Needs you]] [[Done]]",
	"  ├── a → b ✓",
	"  └── `[[Done]]` stays code",
	"**Check:** run it",
].join("\n");
const lumen = (emphasis: Record<string, unknown>) => ({ lumen: { quota: { enabled: false }, icons: "none", emphasis } });
const systemText = (body: { messages: Array<{ role: string; content?: unknown }> }) =>
	JSON.stringify(body.messages.filter((m) => m.role === "system" || m.role === "developer").map((m) => m.content));

describe.skipIf(!hasTmux || !hasPi)("emphasis", () => {
	const h = useSession();

	it("draws square pills with plain Unicode icons, no Nerd Font glyph", async () => {
		const s = await h.start({ responder: () => ({ text: REPLY }), settings: lumen({ enabled: true }) });
		s.send("go");
		await s.settle();
		const screen = s.screen().replace(/ /g, " ");
		expect(screen).toContain("✗ Failed: 3 tests");
		expect(screen).toContain("▸ Needs you");
		expect(screen).toContain("✓ Done");
		expect(screen).toContain("◎ Finding");
		expect(screen).toContain("↳ Cause:");
		expect(screen).toContain("◇ Check:");
		expect(screen).not.toContain("[[Failed");
		expect(screen).toContain("[[Done]] stays code");
		expect(screen).not.toMatch(PUA);
		expect(screen).not.toMatch(/\bCause:.*\*\*/);
		// pills are colored chips: reverse video or a background escape before the label
		expect(s.screenAnsi()).toMatch(/\x1b\[(?:[\d;]*;)?(?:7|48)[;m][^\n]*Needs/);
	});

	it("with pi-lumen's own theme the pills use the theme's panel backgrounds", async () => {
		const s = await h.start({ responder: () => ({ text: REPLY }), asPackage: true, settings: { ...lumen({ enabled: true }), theme: "pi-dark" } });
		s.send("go");
		await s.settle();
		expect(s.screen().replace(/\u00a0/g, " ")).toContain("✓ Done");
		expect(s.screenAnsi()).toMatch(/\x1b\[[\d;]*48;2;[\d;]*m[^\n]*✓/);
	});

	it("short guidance by default: reply_style in the system prompt, small", async () => {
		const s = await h.start({ responder: () => ({ text: "ok" }), settings: lumen({ enabled: true }) });
		s.send("go");
		await s.settle();
		const sys = systemText(s.mock.requests[0] as never);
		expect(sys).toContain("reply_style");
		expect(sys).toContain("[[Needs you]]");
		expect(sys).not.toContain("[[Brainstorm]]");
	});

	it("guidance: full adds the whole rules; off adds none", async () => {
		const full = await h.start({ responder: () => ({ text: "ok" }), settings: lumen({ enabled: true, guidance: "full" }) });
		full.send("go");
		await full.settle();
		expect(systemText(full.mock.requests[0] as never)).toContain("[[Brainstorm]]");
		await full.stop();
		const off = await h.start({ responder: () => ({ text: "ok" }), settings: lumen({ enabled: true, guidance: "off" }) });
		off.send("go");
		await off.settle();
		expect(systemText(off.mock.requests[0] as never)).not.toContain("reply_style");
		await off.waitFor("ok");
	});

	it("disabled (default): replies and prompt stay untouched", async () => {
		const s = await h.start({ responder: () => ({ text: REPLY }), settings: lumen({}) });
		s.send("go");
		await s.settle();
		expect(s.screen()).toContain("[[Failed: 3 tests]]");
		expect(systemText(s.mock.requests[0] as never)).not.toContain("reply_style");
	});

	it("`/lumen emphasis on|off` switches it at runtime and reports it", async () => {
		const s = await h.start({ responder: () => ({ text: "Result [[Done]]" }), settings: lumen({}) });
		s.send("/lumen emphasis maybe");
		await s.waitFor(/Usage: \/lumen emphasis on\|off \(now: off\)/);
		s.send("/lumen emphasis on");
		await s.waitFor(/emphasis on \(short\)/);
		s.send("go");
		await s.settle();
		expect(s.screen().replace(/\u00a0/g, " ")).toContain("✓ Done");
		expect(systemText(s.mock.requests[0] as never)).toContain("reply_style");
		s.send("/lumen emphasis off");
		await s.waitFor(/emphasis off/);
	});

	it("icons: false keeps the pills but drops every icon", async () => {
		const s = await h.start({ responder: () => ({ text: REPLY }), settings: lumen({ enabled: true, icons: false }) });
		s.send("go");
		await s.settle();
		const screen = s.screen().replace(/ /g, " ");
		expect(screen).toContain("Failed: 3 tests");
		expect(screen).not.toContain("✗ Failed");
		expect(screen).not.toContain("◎ Finding");
	});
});
