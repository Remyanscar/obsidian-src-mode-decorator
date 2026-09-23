import { Plugin, MarkdownView } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { StateEffect } from '@codemirror/state';
import { foldEffect } from '@codemirror/language';

import { SourceModeDecoratorSettings, DEFAULT_SETTINGS, SourceModeDecoratorSettingTab, ISMDPlugin } from './settings';
import { metadataFoldService, createEditProtectionFilter, calculateMetadataFoldRange } from './extensions';
import { buildDecoratorViewPlugin } from './decorator';

export default class SourceModeDecoratorPlugin extends Plugin implements ISMDPlugin {
    settings!: SourceModeDecoratorSettings;

    async onload(): Promise<void> {
        await this.loadSettings();
        this.addSettingTab(new SourceModeDecoratorSettingTab(this.app, this));

        this.registerEditorExtension([
            buildDecoratorViewPlugin(this),
            metadataFoldService,
            createEditProtectionFilter(this)
        ]);

        this.app.workspace.on('file-open', () => this.foldAllMetadataBlocks());
        this.app.workspace.on('layout-change', () => this.foldAllMetadataBlocks());

        this.foldAllMetadataBlocks();
    }

    onunload(): void {}

    async loadSettings(): Promise<void> {
        const rawData = (await this.loadData()) as unknown;
        const parsedData = (rawData as Partial<SourceModeDecoratorSettings>) || {};
        this.settings = Object.assign({}, DEFAULT_SETTINGS, parsedData);
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    foldAllMetadataBlocks(): void {
        window.setTimeout(() => {
            const leaves = this.app.workspace.getLeavesOfType("markdown");
            for (const leaf of leaves) {
                if (leaf.view instanceof MarkdownView) {
                    const view = leaf.view;
                    const cm = (view.editor as unknown as { cm?: EditorView }).cm;
                    if (cm) {
                        const doc = cm.state.doc;
                        const effects: StateEffect<unknown>[] = [];

                        for (let i = 1; i <= doc.lines; i++) {
                            const line = doc.line(i);
                            if (/^<!--\s*START Md5:/i.test(line.text)) {
                                const range = calculateMetadataFoldRange(cm.state, line.from);
                                if (range) {
                                    effects.push(foldEffect.of(range));
                                }
                            }
                        }

                        if (effects.length > 0) {
                            cm.dispatch({ effects });
                        }
                    }
                }
            }
        }, 150);
    }
}
