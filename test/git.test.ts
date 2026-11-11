import { describe, expect, it, vi } from "vitest";
import { GitStatusCache, parsePorcelain, readOnlyGitEnv } from "../src/git.ts";

describe("parsePorcelain", () => {
	it("counts staged, unstaged, untracked", () => {
		const out = ["M  a.ts", " M b.ts", "MM c.ts", "?? d.ts", "A  e.ts", " D f.ts", "R  g -> h", ""].join("\n");
		expect(parsePorcelain(out)).toEqual({ staged: 4, unstaged: 3, untracked: 1 });
	});
	it("empty is clean", () => {
		expect(parsePorcelain("")).toEqual({ staged: 0, unstaged: 0, untracked: 0 });
	});
	it("sets GIT_OPTIONAL_LOCKS=0", () => {
		expect(readOnlyGitEnv({ A: "1" })).toEqual({ A: "1", GIT_OPTIONAL_LOCKS: "0" });
	});
});

describe("GitStatusCache", () => {
	const flush = () => new Promise((r) => setTimeout(r, 0));
	it("does nothing without a branch", async () => {
		const run = vi.fn(async () => "");
		const c = new GitStatusCache(() => 2000, () => {}, run);
		expect(c.get("/x", false)).toBeUndefined();
		await flush();
		expect(run).not.toHaveBeenCalled();
	});
	it("fetches once per TTL and notifies on change", async () => {
		let now = 0;
		const run = vi.fn(async () => " M a\n");
		const upd = vi.fn();
		const c = new GitStatusCache(() => 2000, upd, run, () => now);
		expect(c.get("/x", true)).toBeUndefined();
		await flush();
		expect(upd).toHaveBeenCalledTimes(1);
		expect(c.get("/x", true)).toEqual({ staged: 0, unstaged: 1, untracked: 0 });
		expect(run).toHaveBeenCalledTimes(1);
		now = 3000;
		c.get("/x", true);
		await flush();
		expect(run).toHaveBeenCalledTimes(2);
		expect(upd).toHaveBeenCalledTimes(1); // unchanged → no repaint
	});
	it("invalidate forces a refresh; cwd change drops data", async () => {
		const run = vi.fn(async () => "?? a\n");
		const c = new GitStatusCache(() => 60_000, () => {}, run, () => 100);
		c.get("/x", true);
		await flush();
		c.invalidate();
		c.get("/x", true);
		await flush();
		expect(run).toHaveBeenCalledTimes(2);
		expect(c.get("/y", true)).toBeUndefined();
	});
	it("failed git leaves no counters", async () => {
		const c = new GitStatusCache(() => 0, () => {}, async () => null, () => 5);
		c.get("/x", true);
		await flush();
		expect(c.get("/x", true)).toBeUndefined();
	});
});
