/**
 * e2e harness: runs the real `pi` TUI inside tmux, with an isolated agent dir, pi-lumen loaded from
 * this checkout and a scripted mock model. Assertions read the rendered terminal screen.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type MockServer, type Responder, startMock } from "./mock-server.ts";

export const hasTmux = spawnSync("tmux", ["-V"]).status === 0;
const PI_BIN = process.env.PI_BIN ?? join(homedir(), ".pi/agent/bin/pi");
export const hasPi = spawnSync(PI_BIN, ["--version"], { timeout: 20_000 }).status === 0;
const EXT = resolve(import.meta.dirname, "../../src/index.ts");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Session {
	/** Project directory (the cwd of pi); fixture files go here. */
	cwd: string;
	mock: MockServer;
	/** Current visible screen (joined wrapped lines, trailing blanks trimmed). */
	screen(): string;
	/** Visible screen with ANSI escapes kept. */
	screenAnsi(): string;
	/** Whole scrollback + screen. */
	history(): string;
	type(text: string): void;
	press(...keys: string[]): void;
	/** Type a prompt and submit it. */
	send(text: string): void;
	waitFor(re: RegExp | string, timeoutMs?: number): Promise<string>;
	waitGone(re: RegExp | string, timeoutMs?: number): Promise<string>;
	/** Wait until the agent run is over (no "Working" and the model got all its scripted turns). */
	settle(timeoutMs?: number): Promise<string>;
	stop(): Promise<void>;
}

export interface Options {
	responder: Responder;
	cols?: number;
	rows?: number;
	/** Files created in the project dir before start (relative path → content). */
	files?: Record<string, string | Buffer>;
	/** Extra settings.json content (merged over the defaults). */
	settings?: Record<string, unknown>;
	tuiMode?: "fullscreen" | "regular";
}

// Private tmux server: no user config, extended keys on (pi warns otherwise).
const SOCKET = `lumen-e2e-${process.pid}`;
const CONF = join(tmpdir(), `${SOCKET}.conf`);
writeFileSync(CONF, "set -g extended-keys on\nset -g escape-time 0\n");
function tmux(...args: string[]): string {
	return execFileSync("tmux", ["-L", SOCKET, "-f", CONF, ...args], { encoding: "utf8" });
}

export async function startPi(opts: Options): Promise<Session> {
	const root = mkdtempSync(join(tmpdir(), "lumen-e2e-"));
	const agentDir = join(root, "agent");
	const cwd = join(root, "project");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	for (const [rel, content] of Object.entries(opts.files ?? {})) {
		const p = join(cwd, rel);
		mkdirSync(join(p, ".."), { recursive: true });
		writeFileSync(p, content);
	}
	const mock = await startMock(opts.responder);
	writeFileSync(
		join(agentDir, "models.json"),
		JSON.stringify({
			providers: {
				mock: {
					baseUrl: mock.url,
					api: "openai-completions",
					apiKey: "mock-key",
					models: [{ id: "mock-model", name: "Mock Model", contextWindow: 200000, maxTokens: 8192, reasoning: true }],
				},
			},
		}),
	);
	writeFileSync(
		join(agentDir, "settings.json"),
		JSON.stringify({
			defaultProvider: "mock",
			defaultModel: "mock-model",
			defaultThinkingLevel: "medium",
			quietStartup: true,
			lumen: { quota: { enabled: false } },
			...opts.settings,
		}),
	);

	const name = `lumen-e2e-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
	const env = [
		`PI_CODING_AGENT_DIR=${agentDir}`,
		"PI_OFFLINE=1",
		"PI_TELEMETRY=0",
		"TERM=xterm-256color",
		"NO_COLOR=",
		"COLORTERM=truecolor",
		"TZ=UTC",
	];
	const args = ["--no-extensions", "-e", EXT, "--no-context-files", "--no-skills", "--no-session", "--no-mcp", "--tui-mode", opts.tuiMode ?? "fullscreen"];
	const cmd = `env ${env.join(" ")} ${PI_BIN} ${args.join(" ")}`;
	tmux("new-session", "-d", "-s", name, "-x", String(opts.cols ?? 120), "-y", String(opts.rows ?? 50), "-c", cwd, cmd);

	const capture = (ansi: boolean, scrollback: boolean): string => {
		const a = ["capture-pane", "-p", "-J", "-t", name];
		if (ansi) a.push("-e");
		if (scrollback) a.push("-S", "-");
		try {
			return tmux(...a)
				.split("\n")
				.map((l) => l.trimEnd())
				.join("\n")
				.trimEnd();
		} catch {
			return "";
		}
	};
	const matches = (s: string, re: RegExp | string) => (typeof re === "string" ? s.includes(re) : re.test(s));

	const session: Session = {
		cwd,
		mock,
		screen: () => capture(false, false),
		screenAnsi: () => capture(true, false),
		history: () => capture(false, true),
		type: (text) => void tmux("send-keys", "-t", name, "-l", text),
		press: (...keys) => void tmux("send-keys", "-t", name, ...keys),
		send(text) {
			session.type(text);
			session.press("Enter");
		},
		async waitFor(re, timeoutMs = 15_000) {
			const end = Date.now() + timeoutMs;
			let last = "";
			while (Date.now() < end) {
				last = session.screen();
				if (matches(last, re)) return last;
				await sleep(100);
			}
			throw new Error(`timeout waiting for ${re}\n--- screen ---\n${last}\n--------------`);
		},
		async waitGone(re, timeoutMs = 15_000) {
			const end = Date.now() + timeoutMs;
			let last = "";
			while (Date.now() < end) {
				last = session.screen();
				if (!matches(last, re)) return last;
				await sleep(100);
			}
			throw new Error(`timeout waiting for ${re} to disappear\n--- screen ---\n${last}\n--------------`);
		},
		async settle(timeoutMs = 20_000) {
			await sleep(300);
			return session.waitGone(/Working/, timeoutMs);
		},
		async stop() {
			try {
				tmux("kill-session", "-t", name);
			} catch {
				/* already gone */
			}
			await mock.close();
			rmSync(root, { recursive: true, force: true });
		},
	};
	try {
		await session.waitFor("❯", 30_000);
	} catch (e) {
		await session.stop();
		throw e;
	}
	return session;
}

import { afterEach } from "vitest";

/** Registers per-test cleanup; call inside `describe`. */
export function useSession(): { start(o: Options): Promise<Session>; readonly current: Session } {
	let cur: Session | undefined;
	afterEach(async () => {
		await cur?.stop();
		cur = undefined;
	});
	return {
		async start(o) {
			cur = await startPi(o);
			return cur;
		},
		get current() {
			if (!cur) throw new Error("no session started");
			return cur;
		},
	};
}

export const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
export const numbered = (n: number, prefix = "line"): string => `${Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join("\n")}\n`;
/** `<0.01s`, `0.42s`, `3.1s`, `12s`, `1m 04s`. */
export const DUR = String.raw`(?:<0\.01s|\d+\.\d+s|\d+s|\d+m \d\d s)`.replace(" \\d\\d s", " \\d\\ds");
/** Number of SGR (color) escapes in a string. */
export const sgrCount = (s: string): number => (s.match(/\x1b\[[0-9;]*m/g) ?? []).length;
/** The ANSI screen line that contains `text`. */
export const ansiLine = (s: Session, text: string): string => s.screenAnsi().split("\n").find((l) => l.replace(/\x1b\[[0-9;]*m/g, "").includes(text)) ?? "";
