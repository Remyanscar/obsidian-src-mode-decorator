import { EditorState, Transaction, Text } from '@codemirror/state';
import { foldService } from '@codemirror/language';
import type { ISMDPlugin } from './settings';

export interface MetadataHeaderInfo {
    startLineNo: number;
    metaEndLineNo: number;
    linkLineNo: number | null;
}

export function getMetadataHeaderInfo(doc: Text, startLineNo: number): MetadataHeaderInfo | null {
    const startLine = doc.line(startLineNo);
    if (!/^<!--\s*START Md5:/i.test(startLine.text)) return null;

    let metaEndLineNo = -1;
    for (let i = startLineNo; i <= Math.min(startLineNo + 25, doc.lines); i++) {
        const line = doc.line(i);
        if (line.text.includes("-->")) {
            metaEndLineNo = i;
            break;
        }
    }

    if (metaEndLineNo === -1) return null;

    let linkLineNo: number | null = null;
    if (metaEndLineNo + 1 <= doc.lines) {
        const nextLine = doc.line(metaEndLineNo + 1);
        if (/^%%\s*\[Link.*%%\s*$/i.test(nextLine.text)) {
            linkLineNo = metaEndLineNo + 1;
        }
    }

    return {
        startLineNo,
        metaEndLineNo,
        linkLineNo
    };
}

export function calculateMetadataFoldRange(state: EditorState, lineStart: number): { from: number, to: number } | null {
    const line = state.doc.lineAt(lineStart);
    const header = getMetadataHeaderInfo(state.doc, line.number);
    if (!header) return null;

    const endLineNo = header.linkLineNo ?? header.metaEndLineNo;
    const endLine = state.doc.line(endLineNo);

    if (endLine.to <= line.to) return null;

    return { from: line.to, to: endLine.to };
}

export const metadataFoldService = foldService.of((state: EditorState, lineStart: number) => {
    return calculateMetadataFoldRange(state, lineStart);
});

export function createEditProtectionFilter(plugin: ISMDPlugin) {
    return EditorState.changeFilter.of((tr: Transaction) => {
        let isAllowed = true;
        tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
            if (!isAllowed) return;
            const doc = tr.startState.doc;
            const startLine = doc.lineAt(fromA);
            const endLine = doc.lineAt(toA);

            const checkProtection = (lineNo: number): boolean => {
                const lineObj = doc.line(lineNo);
                const text = lineObj.text.trim();
                const pattern = plugin.settings.splitterPattern;
                const hasSplitter = pattern.trim() !== "" && text.includes(pattern);

                if (hasSplitter) return true;
                if (/^<!--\s*END Md5:/i.test(text)) return true;
                if (/^(<!--\s*(ID|Tags):| DELETE )/i.test(text) || /\^[a-zA-Z0-9-]+$/.test(text)) {
                    return true;
                }

                for (let s = lineNo; s >= Math.max(1, lineNo - 26); s--) {
                    const candidateText = doc.line(s).text;
                    if (/^<!--\s*START Md5:/i.test(candidateText)) {
                        const header = getMetadataHeaderInfo(doc, s);
                        if (header) {
                            const lastHeaderLine = header.linkLineNo ?? header.metaEndLineNo;
                            if (lineNo >= header.startLineNo && lineNo <= lastHeaderLine) {
                                return true;
                            }
                        }
                        break;
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
