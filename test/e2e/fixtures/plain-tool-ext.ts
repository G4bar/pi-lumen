// Test fixture: a tool with no renderers of its own (pi would draw it in the default tool box).
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI): void {
	pi.registerTool({
		name: "plain_demo",
		label: "plain_demo",
		description: "fixture",
		parameters: Type.Object({ query: Type.String() }),
		async execute() {
			return { content: [{ type: "text", text: "alpha\nbeta\ngamma" }], details: {} };
		},
	});
}
