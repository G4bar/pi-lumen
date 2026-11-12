// Test fixture: another extension that publishes a footer status and a command.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
	pi.on("session_start", async (_e, ctx) => {
		ctx.ui.setStatus("sync", "synced just-now");
	});
	pi.registerCommand("demo", { description: "fixture", handler: async () => {} });
}
