import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hasPi, hasTmux, useSession } from "./harness.ts";

const FIXTURE = resolve(import.meta.dirname, "fixtures/status-ext.ts");

describe.skipIf(!hasTmux || !hasPi)("/status", () => {
	const h = useSession();

	it("keeps other extensions' statuses out of the status line and shows them in /status", async () => {
		const s = await h.start({ responder: () => ({ text: "fine" }), extensions: [FIXTURE] });
		await s.waitFor("[med]");
		expect(s.screen()).not.toContain("synced just-now");
		s.send("/status");
		await s.waitFor("Extension status");
		const screen = s.screen();
		expect(screen).toMatch(/pi-sync\s+synced just-now/);
		expect(screen).toContain("Loaded (");
	});

	it("an allowlisted key is drawn inline", async () => {
		const s = await h.start({ responder: () => ({ text: "fine" }), extensions: [FIXTURE], settings: { lumen: { quota: { enabled: false }, inlineStatusKeys: ["sync"] } } });
		await s.waitFor("synced just-now");
	});
});
