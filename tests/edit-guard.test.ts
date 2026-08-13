import assert from "node:assert/strict";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { repairChangedHighlightMarkers } from "../src/editor-extension";
import { createHighlightRemovalPlan } from "../src/syntax";

function applyChange(
    document: string,
    from: number,
    to: number,
    insert = "",
): string {
    const state = EditorState.create({
        doc: document,
        extensions: [
            EditorState.transactionFilter.of(
                repairChangedHighlightMarkers,
            ),
        ],
    });

    return state.update({
        changes: { from, to, insert },
    }).newDoc.toString();
}

test("cutting through all visible content removes both markers", () => {
    const document = "before ==pink|Android users== after";
    const contentEnd = document.indexOf("== after");

    assert.equal(
        applyChange(document, 0, contentEnd),
        " after",
    );
});

test("a partial cross-boundary deletion preserves the highlight", () => {
    const document = "before ==pink|Android users== after";
    const throughAndroid = document.indexOf("Android") + 3;

    assert.equal(
        applyChange(document, 0, throughAndroid),
        "==pink|roid users== after",
    );
});

test("retyping all visible content keeps its color", () => {
    const document = "before ==pink|Android users== after";
    const contentStart = document.indexOf("Android");
    const contentEnd = contentStart + "Android users".length;

    assert.equal(
        applyChange(document, contentStart, contentEnd, "New text"),
        "before ==pink|New text== after",
    );
});

test("deleting all visible content removes an empty highlight", () => {
    const document = "before ==pink|Android users== after";
    const contentStart = document.indexOf("Android");
    const contentEnd = contentStart + "Android users".length;

    assert.equal(
        applyChange(document, contentStart, contentEnd),
        "before  after",
    );
});

test("deleting a hidden marker alone restores it", () => {
    const document = "before ==pink|Android users== after";
    const closingStart = document.indexOf("== after");

    assert.equal(
        applyChange(document, closingStart, closingStart + 1),
        document,
    );
});

test("background highlights preserve their longer marker while editing", () => {
    const document = "before ==bg-orange|Android users== after";
    const contentStart = document.indexOf("Android");
    const contentEnd = contentStart + "Android users".length;

    assert.equal(
        applyChange(document, contentStart, contentEnd, "New text"),
        "before ==bg-orange|New text== after",
    );
});

test("cutting background-highlighted content removes both markers", () => {
    const document = "before ==bg-green|Android users== after";
    const contentEnd = document.indexOf("== after");

    assert.equal(
        applyChange(document, 0, contentEnd),
        " after",
    );
});

test("one transaction can unwrap many selected highlights", () => {
    const document = [
        "==pink|First== plain text",
        "Middle ==bg-purple|Second== end",
    ].join("\n");
    const plan = createHighlightRemovalPlan(document, 0, document.length);
    const state = EditorState.create({
        doc: document,
        extensions: [
            EditorState.transactionFilter.of(
                repairChangedHighlightMarkers,
            ),
        ],
    });
    const transaction = state.update({
        changes: plan.changes.map((change) => ({
            from: change.from,
            to: change.to,
            insert: change.text,
        })),
    });

    assert.equal(
        transaction.newDoc.toString(),
        "First plain text\nMiddle Second end",
    );
});
