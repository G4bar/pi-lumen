/**
 * Scripted OpenAI-compatible `/v1/chat/completions` SSE server for e2e tests.
 * Each request is answered by `responder(requestIndex, body)`; no network, fully deterministic.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface ToolCall {
	name: string;
	args: Record<string, unknown>;
}

export interface Step {
	thinking?: string;
	text?: string;
	toolCalls?: ToolCall[];
	/** Delay between streamed chunks (ms), to keep a run "Working" long enough to observe. */
	chunkDelayMs?: number;
	/** Hold the response open for this long before the final chunk. */
	holdMs?: number;
}

export type Responder = (index: number, body: ChatRequest) => Step;

export interface ChatRequest {
	model: string;
	messages: Array<{ role: string; content?: unknown; tool_calls?: unknown; tool_call_id?: string }>;
	[k: string]: unknown;
}

export interface MockServer {
	url: string;
	requests: ChatRequest[];
	close(): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function chunk(delta: Record<string, unknown>, finish: string | null = null, extra: Record<string, unknown> = {}): string {
	return `data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 0, model: "mock", choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
}

/** Split into small pieces so the UI actually streams. */
function pieces(s: string, size = 12): string[] {
	const out: string[] = [];
	for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
	return out;
}

export async function startMock(responder: Responder): Promise<MockServer> {
	const requests: ChatRequest[] = [];
	const server: Server = createServer((req, res) => {
		let raw = "";
		req.on("data", (d) => {
			raw += d;
		});
		req.on("end", async () => {
			if (req.method !== "POST" || !req.url?.includes("/chat/completions")) {
				res.writeHead(404).end();
				return;
			}
			const body = JSON.parse(raw) as ChatRequest;
			const index = requests.push(body) - 1;
			const step = responder(index, body);
			const delay = step.chunkDelayMs ?? 0;
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
			res.write(chunk({ role: "assistant", content: "" }));
			if (step.thinking) {
				for (const p of pieces(step.thinking)) {
					res.write(chunk({ reasoning_content: p }));
					if (delay) await sleep(delay);
				}
			}
			if (step.text) {
				for (const p of pieces(step.text)) {
					res.write(chunk({ content: p }));
					if (delay) await sleep(delay);
				}
			}
			if (step.holdMs) await sleep(step.holdMs);
			const calls = step.toolCalls ?? [];
			calls.forEach((c, i) => {
				res.write(chunk({ tool_calls: [{ index: i, id: `call_${index}_${i}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } }] }));
			});
			res.write(chunk({}, calls.length ? "tool_calls" : "stop"));
			res.write(`data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 0, model: "mock", choices: [], usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 } })}\n\n`);
			res.write("data: [DONE]\n\n");
			res.end();
		});
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const port = (server.address() as AddressInfo).port;
	return {
		url: `http://127.0.0.1:${port}/v1`,
		requests,
		close: () => new Promise<void>((r) => server.close(() => r())),
	};
}
