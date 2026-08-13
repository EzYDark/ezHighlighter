import {
    editorInfoField,
    editorLivePreviewField,
    type Editor,
} from "obsidian";
import {
    EditorState,
    Prec,
    type ChangeSpec,
    type Transaction,
    type TransactionSpec,
} from "@codemirror/state";
import {
    Decoration,
    EditorView,
    MatchDecorator,
    ViewPlugin,
    keymap,
    type DecorationSet,
    type ViewUpdate,
} from "@codemirror/view";
import {
    createHighlightPattern,
    findHighlightAt,
    formatHighlightToken,
    isEscaped,
    isHighlightColorId,
    parseHighlights,
    type HighlightRange,
    type HighlightStyleId,
} from "./syntax";

interface EditorContextClick {
    offset: number;
    recordedAt: number;
}

interface SourceChange {
    from: number;
    to: number;
    insertedLength: number;
}

let latestContextClick: EditorContextClick | null = null;
const activeEditorViews = new Set<EditorView>();

function isLivePreview(view: EditorView): boolean {
    return view.state.field(editorLivePreviewField, false) === true;
}

function getMatchRange(
    match: RegExpExecArray,
    wrapperStart: number,
    wrapperEnd: number,
): HighlightRange | null {
    const backgroundPrefix = match[1];
    const colorId = match[2];
    const content = match[3];

    if (
        colorId === undefined
        || content === undefined
        || content.length === 0
        || !isHighlightColorId(colorId)
    ) {
        return null;
    }

    const styleId: HighlightStyleId = backgroundPrefix
        ? "background"
        : "text";
    const token = formatHighlightToken(styleId, colorId);
    const contentStart = wrapperStart + token.length + 3;

    return {
        styleId,
        colorId,
        content,
        wrapperStart,
        contentStart,
        contentEnd: contentStart + content.length,
        wrapperEnd,
    };
}

function matchIsEscaped(view: EditorView, offset: number): boolean {
    const line = view.state.doc.lineAt(offset);
    return isEscaped(line.text, offset - line.from);
}

const visibleHighlightMatcher = new MatchDecorator({
    regexp: createHighlightPattern(),
    decorate: (add, from, to, match, view) => {
        if (matchIsEscaped(view, from)) {
            return;
        }

        const highlight = getMatchRange(match, from, to);

        if (!highlight) {
            return;
        }

        add(
            highlight.wrapperStart,
            highlight.contentStart,
            Decoration.replace({}),
        );
        add(
            highlight.contentStart,
            highlight.contentEnd,
            Decoration.mark({
                class:
                    `ez-highlighter-highlight ez-highlighter-live-preview `
                    + `ez-highlighter-highlight--${highlight.styleId} `
                    + `ez-highlighter-${highlight.colorId}`,
            }),
        );
        add(
            highlight.contentEnd,
            highlight.wrapperEnd,
            Decoration.replace({}),
        );
    },
});

const atomicMarkerMatcher = new MatchDecorator({
    regexp: createHighlightPattern(),
    decorate: (add, from, to, match, view) => {
        if (matchIsEscaped(view, from)) {
            return;
        }

        const highlight = getMatchRange(match, from, to);

        if (!highlight) {
            return;
        }

        add(
            highlight.wrapperStart,
            highlight.contentStart,
            Decoration.replace({}),
        );
        add(
            highlight.contentEnd,
            highlight.wrapperEnd,
            Decoration.replace({}),
        );
    },
});

const highlighterViewPlugin = ViewPlugin.fromClass(
    class {
        private readonly view: EditorView;
        decorations: DecorationSet;
        atomicDecorations: DecorationSet;

        constructor(view: EditorView) {
            this.view = view;
            activeEditorViews.add(view);

            if (isLivePreview(view)) {
                this.decorations = visibleHighlightMatcher.createDeco(view);
                this.atomicDecorations = atomicMarkerMatcher.createDeco(view);
            } else {
                this.decorations = Decoration.none;
                this.atomicDecorations = Decoration.none;
            }
        }

        update(update: ViewUpdate): void {
            const wasLivePreview =
                update.startState.field(editorLivePreviewField, false) === true;
            const livePreview = isLivePreview(update.view);

            if (!livePreview) {
                this.decorations = Decoration.none;
                this.atomicDecorations = Decoration.none;
            } else if (!wasLivePreview) {
                this.decorations =
                    visibleHighlightMatcher.createDeco(update.view);
                this.atomicDecorations =
                    atomicMarkerMatcher.createDeco(update.view);
            } else {
                this.decorations = visibleHighlightMatcher.updateDeco(
                    update,
                    this.decorations,
                );
                this.atomicDecorations = atomicMarkerMatcher.updateDeco(
                    update,
                    this.atomicDecorations,
                );
            }
        }

        destroy(): void {
            activeEditorViews.delete(this.view);
        }
    },
    {
        decorations: (plugin) => plugin.decorations,
    },
);

function highlightsAffectedBy(
    transaction: Transaction,
    changes: readonly SourceChange[],
): HighlightRange[] {
    const lineNumbers = new Set<number>();
    const document = transaction.startState.doc;

    for (const change of changes) {
        if (change.from === change.to) {
            continue;
        }

        const firstLine = document.lineAt(change.from).number;
        const lastLine = document.lineAt(
            Math.min(change.to, document.length),
        ).number;

        for (let line = firstLine; line <= lastLine; line += 1) {
            lineNumbers.add(line);
        }
    }

    const highlights: HighlightRange[] = [];

    for (const lineNumber of lineNumbers) {
        const line = document.line(lineNumber);
        highlights.push(...parseHighlights(line.text, line.from));
    }

    return highlights;
}

function rangeIntersectsChanges(
    from: number,
    to: number,
    changes: readonly SourceChange[],
): boolean {
    return changes.some((change) =>
        change.from < to
        && change.to > from
    );
}

function rangeIsFullyChanged(
    from: number,
    to: number,
    changes: readonly SourceChange[],
): boolean {
    let coveredUntil = from;

    for (const change of changes) {
        if (change.to <= coveredUntil) {
            continue;
        }

        if (change.from > coveredUntil) {
            return false;
        }

        coveredUntil = Math.max(coveredUntil, change.to);

        if (coveredUntil >= to) {
            return true;
        }
    }

    return false;
}

function replacesOnlyVisibleContent(
    highlight: HighlightRange,
    changes: readonly SourceChange[],
): boolean {
    return changes.some((change) =>
        change.from === highlight.contentStart
        && change.to === highlight.contentEnd
        && change.insertedLength > 0
    );
}

function mappedRepair(
    transaction: Transaction,
    from: number,
    to: number,
    insert?: string,
): ChangeSpec | null {
    const mappedFrom = transaction.changes.mapPos(from, 1);
    const mappedTo = transaction.changes.mapPos(to, -1);

    if (mappedFrom === mappedTo && insert === undefined) {
        return null;
    }

    return {
        from: mappedFrom,
        to: mappedTo,
        ...(insert === undefined ? {} : { insert }),
    };
}

function collectMarkerRepairs(
    transaction: Transaction,
    highlight: HighlightRange,
    changes: readonly SourceChange[],
): ChangeSpec[] {
    const openingMarker = transaction.startState.doc.sliceString(
        highlight.wrapperStart,
        highlight.contentStart,
    );
    const closingMarker = transaction.startState.doc.sliceString(
        highlight.contentEnd,
        highlight.wrapperEnd,
    );
    const contentWasFullyChanged = rangeIsFullyChanged(
        highlight.contentStart,
        highlight.contentEnd,
        changes,
    );
    const keepHighlight =
        !contentWasFullyChanged
        || replacesOnlyVisibleContent(highlight, changes);
    const markerRanges = [
        {
            from: highlight.wrapperStart,
            to: highlight.contentStart,
            source: openingMarker,
        },
        {
            from: highlight.contentEnd,
            to: highlight.wrapperEnd,
            source: closingMarker,
        },
    ];
    const repairs: ChangeSpec[] = [];

    for (const marker of markerRanges) {
        const markerWasChanged = rangeIntersectsChanges(
            marker.from,
            marker.to,
            changes,
        );

        if (keepHighlight && !markerWasChanged) {
            continue;
        }

        const repair = mappedRepair(
            transaction,
            marker.from,
            marker.to,
            keepHighlight ? marker.source : undefined,
        );

        if (repair) {
            repairs.push(repair);
        }
    }

    return repairs;
}

export function repairChangedHighlightMarkers(transaction: Transaction):
    Transaction | readonly [Transaction, TransactionSpec] {
    if (!transaction.docChanged) {
        return transaction;
    }

    const sourceChanges: SourceChange[] = [];

    transaction.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
        sourceChanges.push({
            from,
            to,
            insertedLength: inserted.length,
        });
    });

    const repairs = highlightsAffectedBy(transaction, sourceChanges)
        .flatMap((highlight) =>
            collectMarkerRepairs(transaction, highlight, sourceChanges)
        )
        .sort((left, right) => {
            const leftFrom = "from" in left ? left.from : 0;
            const rightFrom = "from" in right ? right.from : 0;
            return leftFrom - rightFrom;
        });

    if (repairs.length === 0) {
        return transaction;
    }

    return [
        transaction,
        {
            changes: repairs,
            sequential: true,
        },
    ];
}

function highlightAtPosition(
    view: EditorView,
    offset: number,
): HighlightRange | undefined {
    const line = view.state.doc.lineAt(offset);
    return findHighlightAt(
        parseHighlights(line.text, line.from),
        offset,
    );
}

function handleBackspace(view: EditorView): boolean {
    if (!isLivePreview(view)) {
        return false;
    }

    const selection = view.state.selection.main;

    if (!selection.empty) {
        return false;
    }

    const position = selection.head;
    const highlight = highlightAtPosition(view, position);

    if (!highlight) {
        return false;
    }

    if (position === highlight.contentStart) {
        return true;
    }

    if (position !== highlight.wrapperEnd) {
        return false;
    }

    view.dispatch({
        changes: {
            from: highlight.contentEnd - 1,
            to: highlight.contentEnd,
        },
        selection: { anchor: highlight.contentEnd - 1 },
        scrollIntoView: true,
        userEvent: "delete.backward",
    });

    return true;
}

function handleDelete(view: EditorView): boolean {
    if (!isLivePreview(view)) {
        return false;
    }

    const selection = view.state.selection.main;

    if (!selection.empty) {
        return false;
    }

    const position = selection.head;
    const highlight = highlightAtPosition(view, position);

    if (!highlight) {
        return false;
    }

    if (position === highlight.contentEnd) {
        return true;
    }

    if (position !== highlight.wrapperStart) {
        return false;
    }

    view.dispatch({
        changes: {
            from: highlight.contentStart,
            to: highlight.contentStart + 1,
        },
        selection: { anchor: highlight.wrapperStart },
        scrollIntoView: true,
        userEvent: "delete.forward",
    });

    return true;
}

export function consumeEditorContextOffset(): number | null {
    const click = latestContextClick;
    latestContextClick = null;

    if (!click || Date.now() - click.recordedAt > 2000) {
        return null;
    }

    return click.offset;
}

export interface EditorMenuAnchor {
    document: Document;
    x: number;
    y: number;
}

export function getEditorMenuAnchor(editor: Editor):
    EditorMenuAnchor | null {
    for (const view of activeEditorViews) {
        const editorInfo = view.state.field(editorInfoField, false);

        if (editorInfo?.editor !== editor) {
            continue;
        }

        const coordinates = view.coordsAtPos(
            view.state.selection.main.head,
        );

        if (!coordinates) {
            return null;
        }

        return {
            document: view.dom.ownerDocument,
            x: coordinates.left,
            y: coordinates.bottom,
        };
    }

    return null;
}

export const ezHighlighterEditorExtension = [
    highlighterViewPlugin,
    EditorView.atomicRanges.of((view) =>
        view.plugin(highlighterViewPlugin)?.atomicDecorations
        ?? Decoration.none
    ),
    EditorState.transactionFilter.of((transaction) => {
        if (
            transaction.startState.field(
                editorLivePreviewField,
                false,
            ) !== true
        ) {
            return transaction;
        }

        return repairChangedHighlightMarkers(transaction);
    }),
    Prec.highest(keymap.of([
        { key: "Backspace", run: handleBackspace },
        { key: "Delete", run: handleDelete },
    ])),
    EditorView.domEventHandlers({
        contextmenu: (event, view) => {
            const offset = view.posAtCoords({
                x: event.clientX,
                y: event.clientY,
            });

            latestContextClick = offset === null
                ? null
                : { offset, recordedAt: Date.now() };

            return false;
        },
    }),
];
