import { WidgetType, EditorView } from '@codemirror/view';
import { setIcon, Notice } from 'obsidian';
import type { ISMDPlugin, ObsidianApp } from './settings';

export class ExportButtonWidget extends WidgetType {
    constructor(
        public plugin: ISMDPlugin,
        public blockStart: number,
        public blockEnd: number
    ) { super(); }

    eq(other: ExportButtonWidget): boolean {
        return this.blockStart === other.blockStart && this.blockEnd === other.blockEnd;
    }

    toDOM(view: EditorView): HTMLElement {
        const btn = createSpan({ cls: "smd-export-button", attr: { title: "Export this block" } });
        setIcon(btn, "upload");

        btn.onclick = (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const cmdId = this.plugin.settings.exportCommandId.trim();
            if (!cmdId) {
                new Notice("Export command is not selected in settings.");
                return;
            }

            view.dispatch({ selection: { anchor: this.blockStart, head: this.blockEnd } });
            view.focus();

            const appCommands = (this.plugin.app as ObsidianApp).commands;
            if (appCommands.findCommand(cmdId)) {
                appCommands.executeCommandById(cmdId);
            } else {
                new Notice(`Command not found: ${cmdId}`);
            }
        };
        return btn;
    }
}

export class SplitterWidget extends WidgetType {
    toDOM(): HTMLElement {
        const container = createSpan({ cls: "smd-splitter-widget" });
        container.appendChild(createSpan({ cls: "smd-splitter-icon", text: " " }));
        container.appendChild(createSpan({ cls: "smd-splitter-line" }));
        container.appendChild(createSpan({ cls: "smd-splitter-icon", text: " " }));
        return container;
    }
}
