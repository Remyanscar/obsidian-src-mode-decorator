// noinspection JSUnusedGlobalSymbols,JSIgnoredPromiseFromCall

import { Plugin, MarkdownView, App, PluginSettingTab, Notice, Command, setIcon } from 'obsidian';
import { EditorState, StateEffect, Transaction, Range } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, PluginValue, WidgetType } from '@codemirror/view';
import { foldService, foldEffect } from '@codemirror/language';

/**
 * Interface extending the default Obsidian App to access the undocumented Commands API.
 */
interface ObsidianApp extends App {
    commands: {
        executeCommandById(id: string): void;
        findCommand(id: string): Command | undefined;
        commands: Record<string, Command>;
    };
}

/**
 * Settings interface for the MarginNote plugin.
 */
interface MarginNoteSettings {
    splitterPattern: string;
    exportCommandId: string;
}

const DEFAULT_SETTINGS: MarginNoteSettings = {
    splitterPattern: "<!--~-->",
    exportCommandId: ""
};

/**
 * Definitions of linear and textual decorations for MarginNote blocks.
 */
const blockStartClass = Decoration.line({ attributes: { class: "block-start mn-relative-line" } });
const blockEndClass = Decoration.line({ attributes: { class: "block-end" } });

const metaLineClass = Decoration.line({ attributes: { class: "mn-meta-line" } });
const linkLineClass = Decoration.line({ attributes: { class: "mn-source-link" } });
const quoteLineClass = Decoration.line({ attributes: { class: "mn-quote-line" } });
const quoteLastLineClass = Decoration.line({ attributes: { class: "mn-quote-line mn-quote-last-line" } });

const containerStartClass = Decoration.line({ attributes: { class: "block-start mn-container-line mn-relative-line" } });
const containerEndClass = Decoration.line({ attributes: { class: "block-end mn-container-line" } });
const containerMetaClass = Decoration.line({ attributes: { class: "mn-meta-line mn-container-line" } });
const containerLinkClass = Decoration.line({ attributes: { class: "mn-source-link mn-container-line" } });
const containerQuoteClass = Decoration.line({ attributes: { class: "mn-quote-line mn-container-line" } });
const containerQuoteLastClass = Decoration.line({ attributes: { class: "mn-quote-line mn-quote-last-line mn-container-line" } });
const containerLineClass = Decoration.line({ attributes: { class: "mn-container-line" } });

const hrLineClass = Decoration.line({ attributes: { class: "mn-hr-line" } });
const hideSyntaxDeco = Decoration.mark({ class: "mn-hide-syntax" });

/**
 * Custom CodeMirror widget that renders an export button at the end of a block.
 */
class ExportButtonWidget extends WidgetType {
    constructor(
        public plugin: MarginNoteDecoratorPlugin,
        public blockStart: number,
        public blockEnd: number
    ) {
        super();
    }

    eq(other: ExportButtonWidget): boolean {
        return this.blockStart === other.blockStart && this.blockEnd === other.blockEnd;
    }

    toDOM(view: EditorView): HTMLElement {
        const btn = createSpan({ cls: "mn-export-button", attr: { title: "Export this block" } });

        setIcon(btn, "upload");

        btn.onclick = (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const cmdId = this.plugin.settings.exportCommandId.trim();
            if (!cmdId) {
                new Notice("Export command is not selected in settings.");
                return;
            }

            view.dispatch({
                selection: { anchor: this.blockStart, head: this.blockEnd }
            });

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

/**
 * Custom CodeMirror widget that renders a visual splitter icon (e.g., scissors) for boundaries.
 */
class SplitterWidget extends WidgetType {
    toDOM(): HTMLElement {
        const container = createSpan({ cls: "mn-splitter-widget" });
        const iconLeft = createSpan({ cls: "mn-splitter-icon", text: "✂" });
        const line = createSpan({ cls: "mn-splitter-line" });
        const iconRight = createSpan({ cls: "mn-splitter-icon", text: "✂" });

        container.appendChild(iconLeft);
        container.appendChild(line);
        container.appendChild(iconRight);

        return container;
    }
}

/**
 * Calculates the exact editor range to be folded based on MarginNote metadata boundaries.
 */
function getMarginNoteFoldRange(state: EditorState, lineStart: number): { from: number, to: number } | null {
    const line = state.doc.lineAt(lineStart);

    if (/^<!--\s*START Md5:/i.test(line.text)) {
        let foldEnd = line.to;
        let foundMetaEnd = false;

        for (let i = line.number; i <= Math.min(line.number + 25, state.doc.lines); i++) {
            const searchLine = state.doc.line(i);

            if (!foundMetaEnd) {
                if (searchLine.text.includes("-->")) {
                    foundMetaEnd = true;
                    foldEnd = searchLine.to;
                }
            } else {
                if (searchLine.text.trim() === "") {
                    foldEnd = searchLine.to;
                } else if (/^%%\s*\[Link/i.test(searchLine.text)) {
                    foldEnd = searchLine.to;
                    break;
                } else {
                    break;
                }
            }
        }

        if (foundMetaEnd) {
            return { from: line.to, to: foldEnd };
        }
    }
    return null;
}

/**
 * Provides native collapsing of metadata and links using CodeMirror's Fold Service.
 */
const marginNoteFoldService = foldService.of((state: EditorState, lineStart: number) => {
    return getMarginNoteFoldRange(state, lineStart);
});

/**
 * Transaction filter that protects specific margin note metadata lines from being manually edited.
 */
function getMarginNoteProtection(plugin: MarginNoteDecoratorPlugin) {
    return EditorState.changeFilter.of((tr: Transaction) => {
        let isAllowed = true;

        tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
            if (!isAllowed) return;

            const doc = tr.startState.doc;
            const startLine = doc.lineAt(fromA);
            const endLine = doc.lineAt(toA);

            const checkProtection = (lineNo: number): boolean => {
                const text = doc.line(lineNo).text.trim();
                const pattern = plugin.settings.splitterPattern;
                const hasSplitter = pattern.trim() !== "" && text.includes(pattern);

                if (/^(<!--\s*(START Md5|END Md5|ID):|-->|%%\s*\[Link|❌DELETE❌)/i.test(text) ||
                    /\^[a-zA-Z0-9-]+$/.test(text) ||
                    hasSplitter) {
                    return true;
                }

                for (let i = lineNo - 1; i >= Math.max(1, lineNo - 25); i--) {
                    const prevText = doc.line(i).text.trim();
                    if (prevText.includes("-->")) {
                        return false;
                    }
                    if (/^<!--\s*START Md5:/i.test(prevText)) {
                        return true;
                    }
                }

                return false;
            };

            if (endLine.number > startLine.number) {
                if (inserted.length === 0 && (toA - fromA === 1)) {
                    if (checkProtection(startLine.number) || checkProtection(endLine.number)) {
                        isAllowed = false;
                    }
                }
                return;
            }

            const line = startLine;
            if (checkProtection(line.number)) {
                if (fromA === line.to && toA === line.to && inserted.toString() === '\n') return;
                if (fromA === line.from && toA === line.from && inserted.toString() === '\n') return;
                if (fromA <= line.from && toA >= line.to) return;

                isAllowed = false;
            }
        });

        return isAllowed;
    });
}

/**
 * Core visual state machine decorator that parses the document and applies syntax highlighting,
 * widgets, and line classes.
 */
function getMarginNoteViewPlugin(plugin: MarginNoteDecoratorPlugin) {
    class MarginNoteDecorator implements PluginValue {
        decorations: DecorationSet;
        private hasFolded = false;

        constructor(view: EditorView) {
            this.decorations = this.buildDecorations(view);
        }

        update(update: ViewUpdate): void {
            if (!this.hasFolded) {
                this.hasFolded = true;
                window.requestAnimationFrame(() => {
                    const effects: StateEffect<unknown>[] = [];
                    const doc = update.view.state.doc;

                    for (let i = 1; i <= doc.lines; i++) {
                        const line = doc.line(i);
                        if (/^<!--\s*START Md5:/i.test(line.text)) {
                            const range = getMarginNoteFoldRange(update.view.state, line.from);
                            if (range) {
                                effects.push(foldEffect.of(range));
                            }
                        }
                    }

                    if (effects.length > 0) {
                        update.view.dispatch({ effects });
                    }
                });
            }

            if (update.docChanged || update.viewportChanged) {
                this.decorations = this.buildDecorations(update.view);
            }
        }

        buildDecorations(view: EditorView): DecorationSet {
            const decos: Range<Decoration>[] = [];
            const doc = view.state.doc;

            let parseState = 'IDLE';
            let isContainerMode = false;
            let expectedHash = "";
            let quoteLines: { from: number, to: number, text: string }[] = [];

            const pattern = plugin.settings.splitterPattern;
            const escapedPattern = pattern.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
            const splitterRegex = new RegExp(escapedPattern, "g");

            const addHideTokens = (lineFrom: number, text: string) => {
                const regex = /<!--\s*(?:START\s*|END\s*)?|-->/gi;
                let m: RegExpExecArray | null;
                while ((m = regex.exec(text)) !== null) {
                    decos.push(hideSyntaxDeco.range(lineFrom + m.index, lineFrom + m.index + m[0].length));
                }
            };

            const processFirstQuoteLine = (lineFrom: number, text: string) => {
                const calloutMatch = text.match(/^(\s*>\s*)(\[!)([a-zA-Z0-9_ -]+)(?:(\|)([^\]]+))?(])([-+]?)/);
                if (calloutMatch) {
                    const m1 = calloutMatch[1] || "";
                    const m2 = calloutMatch[2] || "";
                    const m3 = calloutMatch[3] || "";
                    const m4 = calloutMatch[4];
                    const m5 = calloutMatch[5];
                    const m6 = calloutMatch[6] || "";
                    const m7 = calloutMatch[7];

                    let currentPos = lineFrom + m1.length;

                    decos.push(hideSyntaxDeco.range(currentPos, currentPos + m2.length));
                    currentPos += m2.length;

                    const typeDeco = Decoration.mark({ class: "mn-callout-badge-type" });
                    decos.push(typeDeco.range(currentPos, currentPos + m3.length));
                    currentPos += m3.length;

                    if (m4 && m5) {
                        decos.push(hideSyntaxDeco.range(currentPos, currentPos + m4.length));
                        currentPos += m4.length;

                        const idDeco = Decoration.mark({ class: "mn-callout-badge-id" });
                        decos.push(idDeco.range(currentPos, currentPos + m5.length));
                        currentPos += m5.length;
                    }

                    decos.push(hideSyntaxDeco.range(currentPos, currentPos + m6.length));
                    currentPos += m6.length;

                    if (m7) {
                        const foldDeco = Decoration.mark({ class: "mn-callout-badge-fold" });
                        decos.push(foldDeco.range(currentPos, currentPos + m7.length));
                    }
                }
            };

            const flushQuotes = () => {
                if (quoteLines.length > 0) {
                    for (let i = 0; i < quoteLines.length; i++) {
                        const qLine = quoteLines[i];
                        if (!qLine) continue;

                        const isLast = (i === quoteLines.length - 1);
                        const isSpecialEnd = /^\s*(<!--\s*ID:|❌DELETE❌)/i.test(qLine.text);

                        if (isLast && isSpecialEnd) {
                            decos.push((isContainerMode ? containerEndClass : blockEndClass).range(qLine.from));
                            addHideTokens(qLine.from, qLine.text);
                        } else {
                            const qClass = isContainerMode
                                ? (isLast ? containerQuoteLastClass : containerQuoteClass)
                                : (isLast ? quoteLastLineClass : quoteLineClass);
                            decos.push(qClass.range(qLine.from));
                        }
                    }
                    quoteLines = [];
                }
            };

            for (let i = 1; i <= doc.lines; i++) {
                const line = doc.line(i);
                const text = line.text;

                const parseRegexMark = (regex: RegExp, leftLen: number, rightLen: number, customClass: string) => {
                    let m: RegExpExecArray | null;
                    while ((m = regex.exec(text)) !== null) {
                        const startPos = line.from + m.index;
                        const fullLen = m[0].length;
                        const customDeco = Decoration.mark({ class: customClass });
                        decos.push(customDeco.range(startPos + leftLen, startPos + fullLen - rightLen));
                    }
                };

                parseRegexMark(/<u>(.*?)<\/u>/gi, 3, 4, "source-underline");

                if (/^\s*\*\*\*\s*$/.test(text)) {
                    decos.push(hrLineClass.range(line.from));
                }

                if (escapedPattern.trim() !== "") {
                    let sMatch: RegExpExecArray | null;
                    splitterRegex.lastIndex = 0;
                    while ((sMatch = splitterRegex.exec(text)) !== null) {
                        const startPos = line.from + sMatch.index;
                        decos.push(Decoration.replace({ widget: new SplitterWidget() }).range(startPos, startPos + sMatch[0].length));
                    }
                }

                const isQuoteLine = /^\s*>/.test(text);
                const isTailLine = /^\s*(<!--\s*Tags:|<!--\s*ID:|❌DELETE❌)/i.test(text);

                if (isContainerMode && parseState !== 'IDLE' && text.includes(`<!--END Md5: ${expectedHash}`)) {
                    flushQuotes();
                    decos.push(containerEndClass.range(line.from));
                    addHideTokens(line.from, text);
                    parseState = 'IDLE';
                    isContainerMode = false;
                    continue;
                }

                if (parseState === 'IDLE') {
                    const startMatch = text.match(/^<!--\s*START Md5:\s*([a-f0-9]+)/i);
                    if (startMatch) {
                        expectedHash = (startMatch[1] || "").trim();
                        isContainerMode = false;

                        for (let j = i + 1; j <= doc.lines; j++) {
                            const futureText = doc.line(j).text;
                            if (futureText.includes(`<!--END Md5: ${expectedHash}`)) {
                                isContainerMode = true;
                                break;
                            }
                            if (/^<!--\s*START Md5:/i.test(futureText)) break;
                        }

                        decos.push((isContainerMode ? containerStartClass : blockStartClass).range(line.from));
                        addHideTokens(line.from, text);

                        let fullBlockEnd = line.to;

                        if (isContainerMode) {
                            for (let j = i + 1; j <= doc.lines; j++) {
                                const lookLine = doc.line(j);
                                fullBlockEnd = lookLine.to;
                                if (lookLine.text.includes(`<!--END Md5: ${expectedHash}`)) break;
                            }
                        } else {
                            let inMeta = !line.text.includes("-->");
                            let hasSeenQuote = false;

                            for (let j = i + 1; j <= doc.lines; j++) {
                                const lookLine = doc.line(j);
                                const t = lookLine.text.trim();

                                if (/^<!--\s*START Md5:/i.test(lookLine.text)) break;

                                if (inMeta) {
                                    fullBlockEnd = lookLine.to;
                                    if (lookLine.text.includes("-->")) inMeta = false;
                                    continue;
                                }

                                if (t === "" || /^%%\s*\[Link/i.test(t)) {
                                    fullBlockEnd = lookLine.to;
                                    continue;
                                }

                                if (/^\s*>/.test(lookLine.text)) {
                                    hasSeenQuote = true;
                                    fullBlockEnd = lookLine.to;
                                    continue;
                                }

                                if (hasSeenQuote && /^(<!--\s*Tags:|<!--\s*ID:|❌DELETE❌|\^[a-zA-Z0-9-]+$)/i.test(t)) {
                                    fullBlockEnd = lookLine.to;
                                    continue;
                                }

                                break;
                            }
                        }

                        const endLineObj = view.state.doc.lineAt(fullBlockEnd);
                        for (let j = endLineObj.number + 1; j <= doc.lines; j++) {
                            const lookLine = doc.line(j);
                            const t = lookLine.text.trim();
                            if (/^(<!--\s*Tags:|<!--\s*ID:|❌DELETE❌|\^[a-zA-Z0-9-]+$)/i.test(t)) {
                                fullBlockEnd = lookLine.to;
                            } else {
                                break;
                            }
                        }

                        decos.push(Decoration.widget({
                            widget: new ExportButtonWidget(plugin, line.from, fullBlockEnd),
                            side: 1
                        }).range(line.to));

                        parseState = text.includes("-->") ? 'AWAIT_LINK' : 'AWAIT_META_END';
                    }
                }
                else if (parseState === 'AWAIT_META_END') {
                    decos.push((isContainerMode ? containerMetaClass : metaLineClass).range(line.from));
                    addHideTokens(line.from, text);
                    if (text.includes("-->")) {
                        parseState = 'AWAIT_LINK';
                    }
                }
                else if (parseState === 'AWAIT_LINK') {
                    if (/^%%\s*\[Link/i.test(text)) {
                        decos.push((isContainerMode ? containerLinkClass : linkLineClass).range(line.from));
                        parseState = 'AWAIT_QUOTE';
                    } else {
                        if (isContainerMode) {
                            decos.push(containerLineClass.range(line.from));
                            parseState = 'CONTAINER_CONTENT';
                        } else {
                            parseState = 'IDLE';
                            i--;
                        }
                    }
                }
                else if (parseState === 'AWAIT_QUOTE') {
                    if (isQuoteLine) {
                        processFirstQuoteLine(line.from, text);
                        quoteLines.push({ from: line.from, to: line.to, text: text });
                        parseState = 'IN_QUOTE';
                    } else if (isTailLine) {
                        quoteLines.push({ from: line.from, to: line.to, text: text });
                        parseState = 'IN_QUOTE_TAIL';
                    } else {
                        if (isContainerMode) {
                            decos.push(containerLineClass.range(line.from));
                            parseState = 'CONTAINER_CONTENT';
                        } else {
                            parseState = 'IDLE';
                            i--;
                        }
                    }
                }
                else if (parseState === 'IN_QUOTE' || parseState === 'IN_QUOTE_TAIL') {
                    if (isQuoteLine) {
                        quoteLines.push({ from: line.from, to: line.to, text: text });
                        parseState = 'IN_QUOTE';
                    } else if (isTailLine) {
                        quoteLines.push({ from: line.from, to: line.to, text: text });
                        parseState = 'IN_QUOTE_TAIL';
                    } else {
                        flushQuotes();
                        if (isContainerMode) {
                            decos.push(containerLineClass.range(line.from));
                            parseState = 'CONTAINER_CONTENT';
                        } else {
                            parseState = 'IDLE';
                            i--;
                        }
                    }
                }
                else if (parseState === 'CONTAINER_CONTENT') {
                    decos.push(containerLineClass.range(line.from));
                }
            }

            flushQuotes();

            return Decoration.set(decos, true);
        }
    }

    return ViewPlugin.fromClass(MarginNoteDecorator, {
        decorations: (value: MarginNoteDecorator) => value.decorations
    });
}

/**
 * Settings UI Tab utilizing the declarative API to support Obsidian 1.13+ settings search.
 */
class MarginNoteSettingTab extends PluginSettingTab {
    plugin: MarginNoteDecoratorPlugin;

    constructor(app: App, plugin: MarginNoteDecoratorPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        // Intentionally left empty as we use the declarative API below
    }

    /**
     * Satisfies the obsidianmd/settings-tab/prefer-setting-definitions linter rule.
     * Required for Obsidian 1.13.0+ to support settings search.
     */
    public getSettingDefinitions(): any[] {
        const appCommands = (this.app as ObsidianApp).commands;
        const commandsDict = appCommands?.commands || {};
        const allCommands: Command[] = Object.values(commandsDict);
        allCommands.sort((a, b) => a.name.localeCompare(b.name));

        const options: Record<string, string> = { "": "--- none ---" };
        allCommands.forEach(cmd => {
            options[cmd.id] = cmd.name;
        });

        return [
            {
                name: 'Splitter pattern',
                desc: 'Pattern used for the clipboard split indicator.',
                control: {
                    type: 'text',
                    key: 'splitterPattern',
                    placeholder: '<!--~-->',
                },
            },
            {
                name: 'Export command',
                desc: 'Select the command to trigger when the export button is clicked.',
                control: {
                    type: 'dropdown',
                    key: 'exportCommandId',
                    options: options,
                },
            },
        ];
    }
}

/**
 * Main entry point for the MarginNoteDecorator plugin.
 */
export default class MarginNoteDecoratorPlugin extends Plugin {
    settings!: MarginNoteSettings;

    async onload(): Promise<void> {
        await this.loadSettings();

        this.addSettingTab(new MarginNoteSettingTab(this.app, this));

        this.registerEditorExtension([
            getMarginNoteViewPlugin(this),
            marginNoteFoldService,
            getMarginNoteProtection(this)
        ]);

        this.app.workspace.on('file-open', () => this.forceFoldAllMarginNotes());
        this.app.workspace.on('layout-change', () => this.forceFoldAllMarginNotes());

        this.forceFoldAllMarginNotes();
    }

    onunload(): void {}

    async loadSettings(): Promise<void> {
        const rawData = (await this.loadData()) as unknown;
        const parsedData = (rawData as Partial<MarginNoteSettings>) || {};
        this.settings = Object.assign({}, DEFAULT_SETTINGS, parsedData);
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    /**
     * Scans active Markdown views and triggers fold effects for margin note boundaries.
     */
    forceFoldAllMarginNotes(): void {
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
                                const range = getMarginNoteFoldRange(cm.state, line.from);
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
