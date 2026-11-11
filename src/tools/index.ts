import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LumenConfig } from "../config.ts";
import { registerBash } from "./bash.ts";
import { registerEditWrite } from "./edit-write.ts";
import { registerRead } from "./read.ts";

/**
 * Overrides read/bash/edit/write with compact renderers. Definitions are spread from the SDK
 * (so promptSnippet/promptGuidelines, schemas and details shapes are kept) and `execute` is
 * delegated to a definition built with the live `ctx.cwd` on every call, so `/cd` is respected.
 */
export function registerTools(pi: ExtensionAPI, getCfg: () => LumenConfig): void {
	registerRead(pi, getCfg);
	registerBash(pi, getCfg);
	registerEditWrite(pi, getCfg);
}
