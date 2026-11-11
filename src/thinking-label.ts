/**
 * Per-row hidden-thinking labels. pi has a single global label shared by every thinking row, so a
 * live counter would repaint all previous rows. Approach adapted from heyhuynhgiabuu/pi-pretty
 * v0.10.0 (src/working-indicator.ts, "per-row labels"), MIT: wrap the component's label setter so
 * each row substitutes its own text. The streaming row shows `Thinking… 3s`, finished rows stay at
 * `Thought for 3s`, unknown rows (older sessions) `Thought`. Any failure passes the label through.
 */
import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import { formatDuration } from "./time.ts";

type Setter = (this: unknown, label: string | undefined) => void;
interface Row {
	ms: number;
	since?: number;
}

const IDLE_LABEL = "Thought";

export class RowThinking {
	private readonly rows = new Map<number, Row>();
	private active: number | undefined;
	private restore: (() => void) | undefined;

	constructor(private readonly now: () => number = Date.now) {}

	/** Wrap the host setter. No-op (global label behaviour) if the host class is missing or reshaped. */
	install(cls: unknown = AssistantMessageComponent): boolean {
		const proto = (cls as { prototype?: { setHiddenThinkingLabel?: Setter } } | undefined)?.prototype;
		const original = proto?.setHiddenThinkingLabel;
		if (!proto || typeof original !== "function" || this.restore) return false;
		const self = this;
		const patched: Setter = function (this: unknown, label) {
			let own = label;
			try {
				const ts = (this as { lastMessage?: { timestamp?: unknown } }).lastMessage?.timestamp;
				if (typeof ts === "number") own = self.labelFor(ts);
			} catch {
				/* keep the incoming label */
			}
			original.call(this, own);
		};
		proto.setHiddenThinkingLabel = patched;
		this.restore = () => {
			if (proto.setHiddenThinkingLabel === patched) proto.setHiddenThinkingLabel = original;
		};
		return true;
	}

	/** Start (or resume) a thinking block of message `ts`. */
	start(ts: number): void {
		const row = this.rows.get(ts) ?? { ms: 0 };
		row.since ??= this.now();
		this.rows.set(ts, row);
		this.active = ts;
	}

	/** Stop the running block of `ts` (or of the active row). */
	stop(ts: number | undefined = this.active): void {
		if (ts === undefined) return;
		const row = this.rows.get(ts);
		if (row?.since !== undefined) {
			row.ms += this.now() - row.since;
			row.since = undefined;
		}
		if (this.active === ts) this.active = undefined;
	}

	get running(): boolean {
		return this.active !== undefined;
	}

	labelFor(ts: number): string {
		const row = this.rows.get(ts);
		if (!row) return IDLE_LABEL;
		const ms = row.ms + (row.since === undefined ? 0 : this.now() - row.since);
		return row.since === undefined ? `Thought for ${formatDuration(ms)}` : `Thinking… ${formatDuration(ms)}`;
	}

	/** Value for pi's global label: only used to trigger the per-row fan-out and for rebuilt rows. */
	globalLabel(): string {
		return this.active === undefined ? IDLE_LABEL : this.labelFor(this.active);
	}

	dispose(): void {
		this.restore?.();
		this.restore = undefined;
		this.rows.clear();
		this.active = undefined;
	}
}
