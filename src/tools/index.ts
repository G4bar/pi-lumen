import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LumenConfig } from "../config.ts";
import { registerToolTimes } from "./at.ts";
import { registerBash } from "./bash.ts";
import { setBoxMode } from "./format.ts";
import { registerEditWrite } from "./edit-write.ts";
import { registerRead } from "./read.ts";
import { registerUniformRows } from "./uniform.ts";

/**
 * Overrides read/bash/edit/write with compact renderers and draws every other tool in the same flat style. Definitions are spread from the SDK
 * (so promptSnippet/promptGuidelines, schemas and details shapes are kept) and `execute` is
 * delegated to a definition built with the live `ctx.cwd` on every call, so `/cd` is respected.
 */
export function registerTools(pi: ExtensionAPI, getCfg: () => LumenConfig): void {
	setBoxMode(() => getCfg().tools.box);
	registerRead(pi, getCfg);
	registerBash(pi, getCfg);
	registerEditWrite(pi, getCfg);
	registerUniformRows(pi, getCfg);
	registerToolTimes(pi, getCfg);
}
