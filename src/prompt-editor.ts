/**
 * Optional `❯` prompt glyph on the first editor line.
 * Approach (unboxed variant) adapted from heyhuynhgiabuu/pi-pretty v0.10.0 (src/prompt-editor.ts), MIT.
 * Skipped when another extension already owns the editor slot or pi no longer exposes the border hooks.
 */
import { CustomEditor, type ExtensionContext } from "@earendil-works/pi-coding-agent";

const SLOT = 2; // glyph + one space

export function canUsePromptEditor(ctx: ExtensionContext): boolean {
	// SAFETY: only reads two method slots by name to feature-detect protected hooks; nothing is called or written.
	const proto = CustomEditor.prototype as unknown as Record<string, unknown>;
	const hooks = typeof proto.renderTopBorder === "function" && typeof proto.renderBottomBorder === "function";
	return hooks && ctx.ui.getEditorComponent() === undefined;
}

export function installPromptEditor(ctx: ExtensionContext, paint: () => (s: string) => string): () => void {
	class PromptEditor extends CustomEditor {
		private userPadding = 0;
		private scrolled = false;

		constructor(tui: ConstructorParameters<typeof CustomEditor>[0], theme: ConstructorParameters<typeof CustomEditor>[1], keybindings: ConstructorParameters<typeof CustomEditor>[2], options?: ConstructorParameters<typeof CustomEditor>[3]) {
			// Keep pi's native behaviour: the "Working" status is drawn inside the editor's top border
			// (the default editor is built with this option; extension editors must opt in).
			super(tui, theme, keybindings, { ...options, embedWorkingStatus: true });
			this.userPadding = super.getPaddingX();
			super.setPaddingX(this.userPadding + SLOT);
		}

		override getPaddingX(): number {
			return this.userPadding;
		}

		override setPaddingX(padding: number): void {
			this.userPadding = Math.max(0, padding);
			super.setPaddingX(this.userPadding + SLOT);
		}

		protected override renderTopBorder(width: number, hiddenLineCount: number): string {
			this.scrolled = hiddenLineCount > 0;
			return super.renderTopBorder(width, hiddenLineCount);
		}

		override render(width: number): string[] {
			const lines = super.render(width);
			const first = lines[1];
			const pad = this.userPadding + SLOT;
			if (!this.scrolled && first && first.startsWith(" ".repeat(pad))) {
				const start = this.userPadding;
				lines[1] = `${first.slice(0, start)}${paint()("❯")} ${first.slice(pad)}`;
			}
			return lines;
		}
	}
	const factory = (tui: ConstructorParameters<typeof CustomEditor>[0], theme: ConstructorParameters<typeof CustomEditor>[1], kb: ConstructorParameters<typeof CustomEditor>[2]) => new PromptEditor(tui, theme, kb);
	ctx.ui.setEditorComponent(factory);
	// Only give the slot back if it is still ours: another extension may have replaced the editor since.
	return () => {
		if (ctx.ui.getEditorComponent() === factory) ctx.ui.setEditorComponent(undefined);
	};
}
