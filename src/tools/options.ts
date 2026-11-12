import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Options pi itself passes to the built-in tool factories (`agent-session.js › _buildRuntime`):
 * `shellCommandPrefix`, `shellPath` and `images.autoResize`. Read from the live settings on every call,
 * so the overridden tools keep honouring them. Any failure yields no options (the SDK defaults).
 */
export interface BuiltinToolOptions {
	bash: { commandPrefix?: string; shellPath?: string };
	read: { autoResizeImages?: boolean };
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

function expandTilde(p: string, home: string = homedir()): string {
	if (p === "~") return home;
	return p.startsWith("~/") ? join(home, p.slice(2)) : p;
}

export function builtinToolOptions(pi: Pick<ExtensionAPI, "getSettings">): BuiltinToolOptions {
	try {
		const s = pi.getSettings() as { shellCommandPrefix?: unknown; shellPath?: unknown; images?: { autoResize?: unknown } };
		const shellPath = str(s.shellPath);
		const autoResize = s.images?.autoResize;
		return {
			bash: { commandPrefix: str(s.shellCommandPrefix), shellPath: shellPath === undefined ? undefined : expandTilde(shellPath) },
			read: typeof autoResize === "boolean" ? { autoResizeImages: autoResize } : {},
		};
	} catch {
		return { bash: {}, read: {} };
	}
}
