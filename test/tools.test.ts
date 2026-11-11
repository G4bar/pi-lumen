import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadBootSettings } from "../src/config.ts";
import { RowThinking } from "../src/thinking-label.ts";
import { outputLines } from "../src/tools/bash.ts";
import { splitRead } from "../src/tools/read.ts";

describe("splitRead", () => {
	it("does not count the trailing newline", () => {
		expect(splitRead("a\nb\n").lines).toEqual(["a", "b"]);
		expect(splitRead("").lines).toEqual([]);
	});
	it("separates pi's continuation notice from the content", () => {
		const r = splitRead("l1\nl2\n\n[98 more lines in file. Use offset=3 to continue.]");
		expect(r.lines).toEqual(["l1", "l2"]);
		expect(r.notice).toBe("[98 more lines in file. Use offset=3 to continue.]");
		expect(splitRead("x\n\n[Showing lines 1-2000 of 3000. Use offset=2001 to continue.]").lines).toEqual(["x"]);
	});
});

describe("outputLines", () => {
	it("ignores the (no output) placeholder, the failure status and the truncation notice", () => {
		expect(outputLines("(no output)")).toEqual([]);
		expect(outputLines("a\nb\n\nCommand exited with code 2")).toEqual(["a", "b"]);
		expect(outputLines("a\n\n[Showing lines 1-2000 of 5000. Full output: /tmp/x]")).toEqual(["a"]);
	});
});

describe("RowThinking", () => {
	it("keeps one label per message and resumes a message's total", () => {
		let t = 0;
		const r = new RowThinking(() => t);
		expect(r.labelFor(1)).toBe("Thought");
		r.start(1);
		t = 3000;
		expect(r.labelFor(1)).toBe("Thinking… 3s");
		r.stop(1);
		r.start(2);
		t = 5000;
		expect(r.labelFor(1)).toBe("Thought for 3s");
		expect(r.labelFor(2)).toBe("Thinking… 2s");
		expect(r.globalLabel()).toBe("Thinking… 2s");
		r.stop(2);
		expect(r.globalLabel()).toBe("Thought");
		r.start(1); // second thinking block of message 1 resumes the count
		t = 6000;
		expect(r.labelFor(1)).toBe("Thinking… 4s");
	});

	it("wraps the host setter per row and restores it", () => {
		class Row {
			label = "";
			lastMessage: { timestamp?: number } | undefined = { timestamp: 7 };
			setHiddenThinkingLabel(l: string): void {
				this.label = l;
			}
		}
		const orig = Row.prototype.setHiddenThinkingLabel;
		const r = new RowThinking(() => 0);
		expect(r.install(Row)).toBe(true);
		const row = new Row();
		row.setHiddenThinkingLabel("global");
		expect(row.label).toBe("Thought");
		row.lastMessage = undefined; // unknown row: the incoming label passes through
		row.setHiddenThinkingLabel("global");
		expect(row.label).toBe("global");
		r.dispose();
		expect(Row.prototype.setHiddenThinkingLabel).toBe(orig);
		expect(r.install({})).toBe(false); // reshaped host: no-op
	});
});

describe("loadBootSettings", () => {
	it("reads global and project `lumen` keys (project wins, deep merge); tolerates missing files", () => {
		const root = mkdtempSync(join(tmpdir(), "lumen-cfg-"));
		const agent = join(root, "agent");
		const proj = join(root, "proj");
		mkdirSync(agent);
		mkdirSync(join(proj, ".pi"), { recursive: true });
		writeFileSync(join(agent, "settings.json"), JSON.stringify({ lumen: { tools: { enabled: false, previewLines: 5 }, placement: "above" } }));
		writeFileSync(join(proj, ".pi", "settings.json"), JSON.stringify({ lumen: { tools: { previewLines: 9 } } }));
		expect(loadBootSettings(agent, proj)).toEqual({ tools: { enabled: false, previewLines: 9 }, placement: "above" });
		expect(loadBootSettings(join(root, "none"), join(root, "none"))).toEqual({});
	});
});
