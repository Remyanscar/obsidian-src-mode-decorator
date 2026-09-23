import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, PluginValue } from '@codemirror/view';
import { StateEffect, Range } from '@codemirror/state';
import { foldEffect } from '@codemirror/language';
import { calculateMetadataFoldRange } from './extensions';
import { ExportButtonWidget, SplitterWidget } from './widgets';
import type { ISMDPlugin } from './settings';

const blockStartClass = Decoration.line({ attributes: { class: "block-start smd-relative-line" } });
const blockEndClass = Decoration.line({ attributes: { class: "block-end" } });
const metaLineClass = Decoration.line({ attributes: { class: "smd-meta-line" } });
const linkLineClass = Decoration.line({ attributes: { class: "smd-source-link" } });
const quoteLineClass = Decoration.line({ attributes: { class: "smd-quote-line" } });
const quoteLastLineClass = Decoration.line({ attributes: { class: "smd-quote-line smd-quote-last-line" } });
const containerStartClass = Decoration.line({ attributes: { class: "block-start smd-container-line smd-relative-line" } });
const containerEndClass = Decoration.line({ attributes: { class: "block-end smd-container-line" } });
const containerMetaClass = Decoration.line({ attributes: { class: "smd-meta-line smd-container-line" } });
const containerLinkClass = Decoration.line({ attributes: { class: "smd-source-link smd-container-line" } });
const containerQuoteClass = Decoration.line({ attributes: { class: "smd-quote-line smd-container-line" } });
const containerQuoteLastClass = Decoration.line({ attributes: { class: "smd-quote-line smd-quote-last-line smd-container-line" } });
const containerLineClass = Decoration.line({ attributes: { class: "smd-container-line" } });
const hrLineClass = Decoration.line({ attributes: { class: "smd-hr-line" } });
const hideSyntaxDeco = Decoration.mark({ class: "smd-hide-syntax" });

export function buildDecoratorViewPlugin(plugin: ISMDPlugin) {
    class SourceModeDecorator implements PluginValue {
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
                            const range = calculateMetadataFoldRange(update.view.state, line.from);
                            if (range) effects.push(foldEffect.of(range));
                        }
                    }
                    if (effects.length > 0) update.view.dispatch({ effects });
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
            const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
                    const [ , m1, m2, m3, m4, m5, m6, m7 ] = calloutMatch;
                    let currentPos = lineFrom + (m1 || "").length;
                    decos.push(hideSyntaxDeco.range(currentPos, currentPos + (m2 || "").length));
                    currentPos += (m2 || "").length;

                    const typeDeco = Decoration.mark({ class: "smd-callout-badge-type" });
                    decos.push(typeDeco.range(currentPos, currentPos + (m3 || "").length));
                    currentPos += (m3 || "").length;

                    if (m4 && m5) {
                        decos.push(hideSyntaxDeco.range(currentPos, currentPos + m4.length));
                        currentPos += m4.length;
                        const idDeco = Decoration.mark({ class: "smd-callout-badge-id" });
                        decos.push(idDeco.range(currentPos, currentPos + m5.length));
                        currentPos += m5.length;
                    }

                    decos.push(hideSyntaxDeco.range(currentPos, currentPos + (m6 || "").length));
                    currentPos += (m6 || "").length;

                    if (m7) {
                        const foldDeco = Decoration.mark({ class: "smd-callout-badge-fold" });
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
                        const isSpecialEnd = /^\s*(<!--\s*ID:| DELETE )/i.test(qLine.text);
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
                        const customDeco = Decoration.mark({ class: customClass });
                        decos.push(customDeco.range(startPos + leftLen, startPos + m[0].length - rightLen));
                    }
                };
                parseRegexMark(/<u>(.*?)<\/u>/gi, 3, 4, "source-underline");

                if (/^\s*\*\*\*\s*$/.test(text)) decos.push(hrLineClass.range(line.from));

                if (escapedPattern.trim() !== "") {
                    let sMatch: RegExpExecArray | null;
                    splitterRegex.lastIndex = 0;
                    while ((sMatch = splitterRegex.exec(text)) !== null) {
                        const startPos = line.from + sMatch.index;
                        decos.push(Decoration.replace({ widget: new SplitterWidget() }).range(startPos, startPos + sMatch[0].length));
                    }
                }

                const isQuoteLine = /^\s*>/.test(text);
                const isTailLine = /^\s*(<!--\s*Tags:|<!--\s*ID:| DELETE )/i.test(text);

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
                                // Usunięto warunek t === "" – link musi następować bezpośrednio
                                if (/^%%\s*\[Link.*%%\s*$/i.test(t)) {
                                    fullBlockEnd = lookLine.to;
                                    continue;
                                }
                                if (/^\s*>/.test(lookLine.text)) {
                                    hasSeenQuote = true;
                                    fullBlockEnd = lookLine.to;
                                    continue;
                                }
                                if (hasSeenQuote && /^(<!--\s*Tags:|<!--\s*ID:| DELETE |\^[a-zA-Z0-9-]+$)/i.test(t)) {
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
                            if (/^(<!--\s*Tags:|<!--\s*ID:| DELETE |\^[a-zA-Z0-9-]+$)/i.test(t)) {
                                fullBlockEnd = lookLine.to;
                            } else break;
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
                    if (text.includes("-->")) parseState = 'AWAIT_LINK';
                }
                else if (parseState === 'AWAIT_LINK') {
                    if (/^%%\s*\[Link.*%%\s*$/i.test(text)) {
                        decos.push((isContainerMode ? containerLinkClass : linkLineClass).range(line.from));
                        parseState = 'AWAIT_QUOTE';
                    } else {
                        if (isContainerMode) {
                            decos.push(containerLineClass.range(line.from));
                            parseState = 'CONTAINER_CONTENT';
                        } else { parseState = 'IDLE'; i--; }
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
                        } else { parseState = 'IDLE'; i--; }
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
                        } else { parseState = 'IDLE'; i--; }
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
    return ViewPlugin.fromClass(SourceModeDecorator, {
        decorations: (value: SourceModeDecorator) => value.decorations
    });
}
