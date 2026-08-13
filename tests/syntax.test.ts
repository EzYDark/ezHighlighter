import assert from "node:assert/strict";
import test from "node:test";
import {
    createHighlightRemovalPlan,
    formatHighlight,
    parseHighlights,
} from "../src/syntax";

function applyRemovalPlan(
    text: string,
    changes: ReturnType<typeof createHighlightRemovalPlan>["changes"],
): string {
    return [...changes]
        .sort((left, right) => right.from - left.from)
        .reduce(
            (result, change) =>
                result.slice(0, change.from)
                + change.text
                + result.slice(change.to),
            text,
        );
}

test("parses multiple compact highlights with exact offsets", () => {
    const text = "A ==pink|first== and ==blue|second==.";
    const highlights = parseHighlights(text);

    assert.equal(highlights.length, 2);
    assert.deepEqual(highlights[0], {
        styleId: "text",
        colorId: "pink",
        content: "first",
        wrapperStart: 2,
        contentStart: 9,
        contentEnd: 14,
        wrapperEnd: 16,
    });
    assert.equal(highlights[1]?.colorId, "blue");
    assert.equal(highlights[1]?.content, "second");
});

test("parses background highlights with their longer marker", () => {
    const text = "A ==bg-blue|second==.";
    const [highlight] = parseHighlights(text);

    assert.deepEqual(highlight, {
        styleId: "background",
        colorId: "blue",
        content: "second",
        wrapperStart: 2,
        contentStart: 12,
        contentEnd: 18,
        wrapperEnd: 20,
    });
});

test("ignores escaped and unsupported compact markers", () => {
    const text = String.raw`\==pink|escaped== ==teal|unknown==`;
    assert.deepEqual(parseHighlights(text), []);
});

test("leaves ordinary Obsidian highlights to Obsidian", () => {
    assert.deepEqual(parseHighlights("==ordinary highlight=="), []);
});

test("does not close on an escaped marker inside the content", () => {
    const text = String.raw`==yellow|one \== two==`;
    const [highlight] = parseHighlights(text);

    assert.equal(highlight?.content, String.raw`one \== two`);
    assert.equal(highlight?.wrapperEnd, text.length);
});

test("formats compact highlights", () => {
    assert.equal(
        formatHighlight("purple", "hello"),
        "==purple|hello==",
    );
    assert.equal(
        formatHighlight("purple", "hello", "background"),
        "==bg-purple|hello==",
    );
});

test("removes every custom highlight from a mixed multi-line selection", () => {
    const source = [
        "# Heading",
        "A ==pink|first== and ==ordinary Obsidian highlight==.",
        "B ==bg-blue|second== with plain text.",
    ].join("\n");
    const plan = createHighlightRemovalPlan(source, 0, source.length);
    const result = applyRemovalPlan(source, plan.changes);

    assert.equal(plan.removed, 2);
    assert.equal(
        result,
        [
            "# Heading",
            "A first and ==ordinary Obsidian highlight==.",
            "B second with plain text.",
        ].join("\n"),
    );
    assert.equal(plan.selectionStart, 0);
    assert.equal(plan.selectionEnd, result.length);
});

test("removes all highlights intersecting a partial mixed selection", () => {
    const source = "Before ==red|first== middle ==green|second== after";
    const from = source.indexOf("rst");
    const to = source.indexOf("ond") + "ond".length;
    const plan = createHighlightRemovalPlan(source, from, to);

    assert.equal(plan.removed, 2);
    assert.equal(
        applyRemovalPlan(source, plan.changes),
        "Before first middle second after",
    );
});

test("caret removal selects the unwrapped highlighted text", () => {
    const source = "Before ==bg-orange|selected text== after";
    const caret = source.indexOf("selected") + 3;
    const plan = createHighlightRemovalPlan(source, caret, caret);
    const result = applyRemovalPlan(source, plan.changes);

    assert.equal(plan.removed, 1);
    assert.equal(result, "Before selected text after");
    assert.equal(
        result.slice(plan.selectionStart, plan.selectionEnd),
        "selected text",
    );
});

test("plain selections produce no highlight-removal changes", () => {
    const source = "Only plain text and ==ordinary highlight==.";
    const plan = createHighlightRemovalPlan(source, 0, source.length);

    assert.equal(plan.removed, 0);
    assert.deepEqual(plan.changes, []);
    assert.equal(plan.selectionStart, 0);
    assert.equal(plan.selectionEnd, source.length);
});
