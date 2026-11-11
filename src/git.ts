/**
 * Git status counters with TTL cache.
 *
 * Porcelain parsing and the `GIT_OPTIONAL_LOCKS=0` rationale are ported from
 * nicobailon/pi-powerline-footer v0.22.0 (git-status.ts), MIT.
 * The branch itself comes for free from pi's footerData; only counters need `git status`.
 */
import { spawn } from "node:child_process";

export interface GitCounts {
	staged: number;
	unstaged: number;
	untracked: number;
}

/** Parse `git status --porcelain=v1`: `XY file`; `??` untracked, X != " " staged, Y != " " unstaged. */
export function parsePorcelain(output: string): GitCounts {
	const c: GitCounts = { staged: 0, unstaged: 0, untracked: 0 };
	for (const line of output.split("\n")) {
		if (!line) continue;
		const x = line[0];
		const y = line[1];
		if (x === "?" && y === "?") {
			c.untracked++;
			continue;
		}
		if (x && x !== " " && x !== "?") c.staged++;
		if (y && y !== " ") c.unstaged++;
	}
	return c;
}

/** Read-only env: `status` must not refresh the index and take `.git/index.lock`. */
export function readOnlyGitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	return { ...env, GIT_OPTIONAL_LOCKS: "0" };
}

export type GitRunner = (cwd: string, timeoutMs: number) => Promise<string | null>;

export const runGitStatus: GitRunner = (cwd, timeoutMs) =>
	new Promise((resolve) => {
		let out = "";
		let done = false;
		const finish = (v: string | null): void => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			resolve(v);
		};
		let proc: ReturnType<typeof spawn>;
		try {
			proc = spawn("git", ["status", "--porcelain=v1"], { cwd, env: readOnlyGitEnv(), stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
		} catch {
			resolve(null);
			return;
		}
		const timer = setTimeout(() => {
			proc.kill("SIGKILL");
			finish(null);
		}, timeoutMs);
		proc.stdout?.on("data", (d: Buffer) => {
			out += d.toString();
		});
		proc.on("error", () => finish(null));
		proc.on("close", (code) => finish(code === 0 ? out : null));
	});

export class GitStatusCache {
	private counts: GitCounts | undefined;
	private fetchedAt = Number.NEGATIVE_INFINITY;
	private inflight = false;
	private cwd = "";
	private generation = 0;
	private disposed = false;

	constructor(
		private readonly ttlMs: () => number,
		private readonly onUpdate: () => void,
		private readonly run: GitRunner = runGitStatus,
		private readonly now: () => number = Date.now,
		private readonly timeoutMs = 500,
	) {}

	/** Cached counters; kicks a background refresh when stale. Never blocks, never throws. */
	get(cwd: string, hasBranch: boolean): GitCounts | undefined {
		if (cwd !== this.cwd) {
			this.cwd = cwd;
			this.counts = undefined;
			this.fetchedAt = Number.NEGATIVE_INFINITY;
			this.generation++;
			this.inflight = false;
		}
		if (!hasBranch || this.disposed) return undefined;
		if (!this.inflight && this.now() - this.fetchedAt >= this.ttlMs()) void this.refresh();
		return this.counts;
	}

	invalidate(): void {
		this.fetchedAt = Number.NEGATIVE_INFINITY;
		this.generation++;
		this.inflight = false;
	}

	dispose(): void {
		this.disposed = true;
		this.generation++;
	}

	private async refresh(): Promise<void> {
		const gen = this.generation;
		this.inflight = true;
		const out = await this.run(this.cwd, this.timeoutMs);
		if (gen !== this.generation || this.disposed) return;
		this.inflight = false;
		this.fetchedAt = this.now();
		const next = out === null ? undefined : parsePorcelain(out);
		const changed = JSON.stringify(next) !== JSON.stringify(this.counts);
		this.counts = next;
		if (changed) this.onUpdate();
	}
}
