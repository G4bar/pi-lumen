import { basename, dirname } from "node:path";
import { plural } from "./tools/format.ts";

/** Friendly names for status keys of well-known extensions; unknown keys are shown as published. */
const LABELS: Record<string, string> = {
	sync: "pi-sync",
	"pi-lens-lsp": "pi-lens · LSP",
};

export interface LoadedExtension {
	name: string;
	commands: number;
	tools: number;
}

export interface StatusInput {
	/** Statuses published by extensions; `undefined` when the footer data is not available. */
	statuses: ReadonlyMap<string, string> | undefined;
	/** Why `statuses` is unavailable, shown instead of the list. */
	unavailable?: string;
	loaded: LoadedExtension[];
	/** One-line pi-lumen state. */
	header: string;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips terminal escapes
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/** One printable line: no escapes, no control characters, collapsed whitespace. */
export function cleanText(s: string): string {
	return s
		.replace(ANSI, "")
		.replace(/[\x00-\x1f\x7f]+/g, " ")
		.replace(/ {2,}/g, " ")
		.trim();
}

export function statusLabel(key: string): string {
	return LABELS[key] ?? key;
}

interface SourceLike {
	source: string;
	path: string;
	origin: string;
}

/** Group key shown for a command/tool: package source, otherwise the extension file/dir name. */
export function extensionName(info: SourceLike | undefined): string {
	if (!info) return "?";
	if (info.path.startsWith("builtin:") || info.source.startsWith("builtin")) return "pi (built-in)";
	if (info.origin === "package" && info.source) return info.source;
	const base = basename(info.path).replace(/\.(?:[cm]?[jt]s)$/, "");
	return base === "index" ? basename(dirname(info.path)) || info.source : base || info.source;
}

/** Count commands and tools per extension; entries without any command or tool are not known to pi. */
export function groupLoaded(commands: Array<{ source: string; info?: SourceLike }>, tools: Array<{ info?: SourceLike }>): LoadedExtension[] {
	const map = new Map<string, LoadedExtension>();
	const entry = (name: string): LoadedExtension => {
		let e = map.get(name);
		if (!e) map.set(name, (e = { name, commands: 0, tools: 0 }));
		return e;
	};
	for (const c of commands) if (c.source === "extension") entry(extensionName(c.info)).commands++;
	for (const t of tools) entry(extensionName(t.info)).tools++;
	return [...map.values()].sort((a, b) => Number(a.name.startsWith("pi (")) - Number(b.name.startsWith("pi (")) || a.name.localeCompare(b.name));
}

const pad = (s: string, n: number): string => s + " ".repeat(Math.max(0, n - s.length));

export function formatStatusReport(input: StatusInput): string {
	const out: string[] = [input.header, ""];

	out.push("Extension status");
	if (!input.statuses) {
		out.push(`  ${input.unavailable ?? "not available"}`);
	} else {
		const rows = [...input.statuses]
			.map(([key, text]) => [statusLabel(key), cleanText(text)] as const)
			.filter(([, text]) => text.length > 0)
			.sort((a, b) => a[0].localeCompare(b[0]));
		if (rows.length === 0) out.push("  no extension has published a status");
		const w = Math.max(0, ...rows.map(([label]) => label.length));
		for (const [label, text] of rows) out.push(`  ${pad(label, w)}  ${text}`);
	}

	if (input.loaded.length) {
		out.push("", `Loaded (${input.loaded.length})`);
		const w = Math.max(...input.loaded.map((e) => e.name.length));
		for (const e of input.loaded) {
			const parts = [e.commands ? plural(e.commands, "command") : "", e.tools ? plural(e.tools, "tool") : ""].filter(Boolean);
			out.push(`  ${pad(e.name, w)}  ${parts.join(" · ")}`);
		}
	}
	return out.join("\n");
}
