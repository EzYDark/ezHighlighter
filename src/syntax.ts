export const HIGHLIGHT_COLORS = [
    { id: "pink", label: "Pink" },
    { id: "red", label: "Red" },
    { id: "orange", label: "Orange" },
    { id: "yellow", label: "Yellow" },
    { id: "green", label: "Green" },
    { id: "cyan", label: "Cyan" },
    { id: "blue", label: "Blue" },
    { id: "purple", label: "Purple" },
    { id: "grey", label: "Grey" },
] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];
export type HighlightColorId = HighlightColor["id"];
export type HighlightStyleId = "text" | "background";

export interface HighlightRange {
    styleId: HighlightStyleId;
    colorId: HighlightColorId;
    content: string;
    wrapperStart: number;
    contentStart: number;
    contentEnd: number;
    wrapperEnd: number;
}

export interface TextChange {
    from: number;
    to: number;
    text: string;
}

export interface HighlightRemovalPlan {
    changes: TextChange[];
    removed: number;
    selectionStart: number;
    selectionEnd: number;
}

const COLOR_IDS = HIGHLIGHT_COLORS.map((color) => color.id);
const COLOR_PATTERN = COLOR_IDS.join("|");

// Backslash escapes are included so an escaped \== inside the text does not
// prematurely close a highlight. MatchDecorator requires a global RegExp.
export const COMPACT_HIGHLIGHT_PATTERN =
    `==(bg-)?(${COLOR_PATTERN})\\|((?:\\\\.|[^\\\\\n])*?)==`;

const COLOR_ID_SET = new Set<string>(COLOR_IDS);

export function isHighlightColorId(value: string):
    value is HighlightColorId {
    return COLOR_ID_SET.has(value);
}

export function createHighlightPattern(): RegExp {
    return new RegExp(COMPACT_HIGHLIGHT_PATTERN, "g");
}

export function isEscaped(text: string, index: number): boolean {
    let backslashes = 0;

    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        if (text[cursor] !== "\\") {
            break;
        }

        backslashes += 1;
    }

    return backslashes % 2 === 1;
}

export function parseHighlights(
    text: string,
    baseOffset = 0,
): HighlightRange[] {
    const highlights: HighlightRange[] = [];
    const pattern = createHighlightPattern();

    for (const match of text.matchAll(pattern)) {
        const matchStart = match.index;
        const completeMatch = match[0];
        const backgroundPrefix = match[1];
        const colorId = match[2];
        const content = match[3];

        if (
            matchStart === undefined
            || completeMatch === undefined
            || colorId === undefined
            || content === undefined
            || content.length === 0
            || !isHighlightColorId(colorId)
            || isEscaped(text, matchStart)
        ) {
            continue;
        }

        const styleId: HighlightStyleId = backgroundPrefix
            ? "background"
            : "text";
        const wrapperStart = baseOffset + matchStart;
        const token = formatHighlightToken(styleId, colorId);
        const contentStart = wrapperStart + token.length + 3;
        const contentEnd = contentStart + content.length;

        highlights.push({
            styleId,
            colorId,
            content,
            wrapperStart,
            contentStart,
            contentEnd,
            wrapperEnd: wrapperStart + completeMatch.length,
        });
    }

    return highlights;
}

export function findHighlightAt(
    highlights: readonly HighlightRange[],
    offset: number,
): HighlightRange | undefined {
    return highlights.find((highlight) =>
        offset >= highlight.wrapperStart
        && offset <= highlight.wrapperEnd
    );
}

function mapOffsetAfterHighlightRemoval(
    offset: number,
    highlights: readonly HighlightRange[],
): number {
    let removedBefore = 0;

    for (const highlight of highlights) {
        const markerLength =
            highlight.wrapperEnd
            - highlight.wrapperStart
            - highlight.content.length;

        if (offset >= highlight.wrapperEnd) {
            removedBefore += markerLength;
            continue;
        }

        if (offset <= highlight.wrapperStart) {
            break;
        }

        const replacementStart = highlight.wrapperStart - removedBefore;

        if (offset <= highlight.contentStart) {
            return replacementStart;
        }

        if (offset <= highlight.contentEnd) {
            return replacementStart + offset - highlight.contentStart;
        }

        return replacementStart + highlight.content.length;
    }

    return offset - removedBefore;
}

export function createHighlightRemovalPlan(
    text: string,
    selectionStart: number,
    selectionEnd: number,
): HighlightRemovalPlan {
    const from = Math.min(selectionStart, selectionEnd);
    const to = Math.max(selectionStart, selectionEnd);
    const allHighlights = parseHighlights(text);
    const highlights = from === to
        ? allHighlights.filter((highlight) =>
            from >= highlight.wrapperStart
            && from <= highlight.wrapperEnd
        )
        : allHighlights.filter((highlight) =>
            from < highlight.wrapperEnd
            && to > highlight.wrapperStart
        );

    if (highlights.length === 0) {
        return {
            changes: [],
            removed: 0,
            selectionStart: from,
            selectionEnd: to,
        };
    }

    const caretHighlight = from === to ? highlights[0] : undefined;
    const mappedStart = caretHighlight
        ? caretHighlight.wrapperStart
        : mapOffsetAfterHighlightRemoval(from, highlights);
    const mappedEnd = caretHighlight
        ? caretHighlight.wrapperStart + caretHighlight.content.length
        : mapOffsetAfterHighlightRemoval(to, highlights);

    return {
        changes: highlights.map((highlight) => ({
            from: highlight.wrapperStart,
            to: highlight.wrapperEnd,
            text: highlight.content,
        })),
        removed: highlights.length,
        selectionStart: mappedStart,
        selectionEnd: mappedEnd,
    };
}

export function formatHighlight(
    colorId: HighlightColorId,
    content: string,
    styleId: HighlightStyleId = "text",
): string {
    return `==${formatHighlightToken(styleId, colorId)}|${content}==`;
}

export function formatHighlightToken(
    styleId: HighlightStyleId,
    colorId: HighlightColorId,
): string {
    return styleId === "background" ? `bg-${colorId}` : colorId;
}

export function parseHighlightToken(token: string): {
    styleId: HighlightStyleId;
    colorId: HighlightColorId;
} | null {
    const styleId: HighlightStyleId = token.startsWith("bg-")
        ? "background"
        : "text";
    const colorId = styleId === "background" ? token.slice(3) : token;

    if (!isHighlightColorId(colorId)) {
        return null;
    }

    return { styleId, colorId };
}

export function containsUnescapedClosingMarker(text: string): boolean {
    for (let index = 0; index < text.length - 1; index += 1) {
        if (
            text[index] === "="
            && text[index + 1] === "="
            && !isEscaped(text, index)
        ) {
            return true;
        }
    }

    return false;
}
