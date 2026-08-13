import {
    Editor,
    Menu,
    MenuItem,
    Notice,
    Plugin,
    type Command,
} from "obsidian";
import {
    consumeEditorContextOffset,
    getEditorMenuAnchor,
    ezHighlighterEditorExtension,
} from "./editor-extension";
import {
    HIGHLIGHT_COLORS,
    containsUnescapedClosingMarker,
    createHighlightRemovalPlan,
    findHighlightAt,
    formatHighlight,
    formatHighlightToken,
    parseHighlightToken,
    parseHighlights,
    type HighlightColor,
    type HighlightRange,
    type HighlightStyleId,
} from "./syntax";

type SubmenuCapableItem = MenuItem & {
    dom?: HTMLElement;
    submenu?: Menu | null;
    setSubmenu?: () => Menu;
};

type InspectableMenu = Menu & {
    items?: unknown[];
};

type CommandRegistry = {
    commands: Record<string, Command | undefined>;
};

const CLEAR_FORMATTING_COMMAND_IDS = [
    "editor:clear-formatting",
    "editing-toolbar:format-eraser",
] as const;

const HIGHLIGHT_STYLES = [
    { id: "text", label: "Text highlight", icon: "highlighter" },
    { id: "background", label: "Background highlight", icon: "paint-bucket" },
] as const satisfies readonly {
    id: HighlightStyleId;
    label: string;
    icon: string;
}[];

export default class EzHighlighterPlugin extends Plugin {
    onload(): void {
        this.registerEditorExtension(ezHighlighterEditorExtension);

        this.registerMarkdownPostProcessor((element) => {
            this.processReadingViewHighlights(element);
        });

        this.registerEvent(
            this.app.workspace.on("editor-menu", (menu, editor) => {
                this.configureEditorMenu(menu, editor);
            }),
        );

        this.registerToolbarCommands();

        this.app.workspace.onLayoutReady(() => {
            this.installClearFormattingIntegration();
        });
    }

    private registerToolbarCommands(): void {
        this.addCommand({
            id: "choose-highlight-color",
            name: "Choose highlight style and color…",
            icon: "highlighter",
            editorCallback: (editor) => {
                this.showColorMenu(editor, null);
            },
        });

        for (const style of HIGHLIGHT_STYLES) {
            this.addCommand({
                id: `choose-${style.id}-highlight-color`,
                name: `Choose ${style.label.toLowerCase()} color…`,
                icon: style.icon,
                editorCallback: (editor) => {
                    this.showColorMenu(editor, style.id);
                },
            });
        }

        for (const color of HIGHLIGHT_COLORS) {
            this.addCommand({
                id: `highlight-${color.id}`,
                name: `Text highlight with ${color.label}`,
                icon: "highlighter",
                editorCallback: (editor) => {
                    this.applyHighlight(
                        editor,
                        color,
                        "text",
                        this.findExistingHighlight(editor, null),
                    );
                },
            });

            this.addCommand({
                id: `background-highlight-${color.id}`,
                name: `Background highlight with ${color.label}`,
                icon: "paint-bucket",
                editorCallback: (editor) => {
                    this.applyHighlight(
                        editor,
                        color,
                        "background",
                        this.findExistingHighlight(editor, null),
                    );
                },
            });
        }

        this.addCommand({
            id: "remove-highlight",
            name: "Remove highlight(s)",
            icon: "eraser",
            editorCallback: (editor) => {
                this.removeSelectedHighlights(editor, true);
            },
        });
    }

    private showColorMenu(
        editor: Editor,
        styleId: HighlightStyleId | null,
    ): void {
        const existingHighlight = this.findExistingHighlight(editor, null);
        const canRemoveHighlights = this.hasHighlightsForRemoval(editor);

        if (!editor.somethingSelected() && !existingHighlight) {
            new Notice("Select text or place the cursor inside a highlight.");
            return;
        }

        const anchor = getEditorMenuAnchor(editor);
        const document = anchor?.document ?? activeDocument;
        const viewport = document.defaultView;
        const colorMenu = new Menu();

        if (styleId === null) {
            this.populateHighlightMenu(
                colorMenu,
                editor,
                existingHighlight,
                canRemoveHighlights,
                document,
            );
        } else {
            this.populateColorMenu(
                colorMenu,
                editor,
                existingHighlight,
                styleId,
                document,
                true,
                canRemoveHighlights,
            );
        }

        colorMenu.showAtPosition(
            {
                x: anchor?.x ?? (viewport?.innerWidth ?? 0) / 2,
                y: anchor?.y ?? (viewport?.innerHeight ?? 0) / 2,
            },
            document,
        );
    }

    private configureEditorMenu(menu: Menu, editor: Editor): void {
        const contextOffset = consumeEditorContextOffset();
        const existingHighlight = this.findExistingHighlight(
            editor,
            contextOffset,
        );

        if (!editor.somethingSelected() && !existingHighlight) {
            return;
        }

        if (
            existingHighlight
            && contextOffset !== null
            && !editor.somethingSelected()
        ) {
            editor.setSelection(
                editor.offsetToPos(existingHighlight.contentStart),
                editor.offsetToPos(existingHighlight.contentEnd),
            );
        }

        const canRemoveHighlights = this.hasHighlightsForRemoval(editor);

        const coreItem = this.findCoreHighlightMenuItem(menu);

        if (coreItem && this.attachHighlightSubmenu(
            coreItem,
            editor,
            existingHighlight,
            canRemoveHighlights,
        )) {
            return;
        }

        // Defensive fallback if Obsidian changes the internal Format menu.
        menu.addItem((item) => {
            item
                .setTitle(existingHighlight ? "Edit highlight" : "Highlight")
                .setIcon("highlighter");

            if (!this.attachHighlightSubmenu(
                item,
                editor,
                existingHighlight,
                canRemoveHighlights,
            )) {
                item
                    .setTitle("Highlight (update required)")
                    .setDisabled(true);
            }
        });
    }

    private attachHighlightSubmenu(
        item: MenuItem,
        editor: Editor,
        existingHighlight: HighlightRange | null,
        canRemoveHighlights: boolean,
    ): boolean {
        const submenuItem = item as SubmenuCapableItem;

        if (typeof submenuItem.setSubmenu !== "function") {
            return false;
        }

        item
            .setTitle(existingHighlight ? "Edit highlight" : "Highlight")
            .setDisabled(false);

        const highlightMenu = submenuItem.setSubmenu();
        this.populateHighlightMenu(
            highlightMenu,
            editor,
            existingHighlight,
            canRemoveHighlights,
        );
        return true;
    }

    private findCoreHighlightMenuItem(menu: Menu): MenuItem | null {
        const items = (menu as InspectableMenu).items;

        if (!Array.isArray(items)) {
            return null;
        }

        for (const entry of items) {
            if (!(entry instanceof MenuItem)) {
                continue;
            }

            const submenu = (entry as SubmenuCapableItem).submenu;
            const submenuItems = (submenu as InspectableMenu | null)?.items;

            if (!Array.isArray(submenuItems)) {
                continue;
            }

            for (const submenuEntry of submenuItems) {
                if (!(submenuEntry instanceof MenuItem)) {
                    continue;
                }

                const element = (submenuEntry as SubmenuCapableItem).dom;

                if (element?.querySelector(".lucide-highlighter")) {
                    return submenuEntry;
                }
            }
        }

        return null;
    }

    private populateHighlightMenu(
        highlightMenu: Menu,
        editor: Editor,
        existingHighlight: HighlightRange | null,
        canRemoveHighlights: boolean,
        fallbackDocument: Document = activeDocument,
    ): void {
        for (const style of HIGHLIGHT_STYLES) {
            highlightMenu.addItem((item) => {
                const submenuItem = item as SubmenuCapableItem;

                item
                    .setTitle(style.label)
                    .setIcon(style.icon);

                if (typeof submenuItem.setSubmenu !== "function") {
                    item.setDisabled(true);
                    return;
                }

                this.populateColorMenu(
                    submenuItem.setSubmenu(),
                    editor,
                    existingHighlight,
                    style.id,
                    fallbackDocument,
                    false,
                    canRemoveHighlights,
                );
            });
        }

        if (!canRemoveHighlights) {
            return;
        }

        this.addRemoveItem(highlightMenu, editor);
    }

    private populateColorMenu(
        colorMenu: Menu,
        editor: Editor,
        existingHighlight: HighlightRange | null,
        styleId: HighlightStyleId,
        fallbackDocument: Document,
        includeRemove: boolean,
        canRemoveHighlights: boolean,
    ): void {
        for (const color of HIGHLIGHT_COLORS) {
            colorMenu.addItem((item) => {
                const document =
                    (item as SubmenuCapableItem).dom?.ownerDocument
                    ?? fallbackDocument;

                item
                    .setTitle(this.createColorLabel(color, document))
                    .setChecked(
                        existingHighlight?.styleId === styleId
                        && existingHighlight.colorId === color.id,
                    )
                    .onClick(() => {
                        this.applyHighlight(
                            editor,
                            color,
                            styleId,
                            existingHighlight,
                        );
                    });
            });
        }

        if (!includeRemove || !canRemoveHighlights) {
            return;
        }

        this.addRemoveItem(colorMenu, editor);
    }

    private addRemoveItem(
        menu: Menu,
        editor: Editor,
    ): void {
        menu.addSeparator();
        menu.addItem((item) => {
            item
                .setTitle("Remove highlight")
                .setIcon("eraser")
                .onClick(() => {
                    this.removeSelectedHighlights(editor, true);
                });
        });
    }

    private createColorLabel(
        color: HighlightColor,
        document: Document,
    ): DocumentFragment {
        const fragment = document.createDocumentFragment();
        const swatch = document.createElement("span");
        const label = document.createElement("span");

        swatch.className =
            `ez-highlighter-swatch ez-highlighter-swatch--${color.id} `
            + `ez-highlighter-${color.id}`;
        label.textContent = color.label;
        fragment.append(swatch, label);

        return fragment;
    }

    private applyHighlight(
        editor: Editor,
        color: HighlightColor,
        styleId: HighlightStyleId,
        existingHighlight: HighlightRange | null,
    ): void {
        if (existingHighlight) {
            const replacement = formatHighlight(
                color.id,
                existingHighlight.content,
                styleId,
            );

            editor.replaceRange(
                replacement,
                editor.offsetToPos(existingHighlight.wrapperStart),
                editor.offsetToPos(existingHighlight.wrapperEnd),
            );

            const token = formatHighlightToken(styleId, color.id);
            const contentStart = existingHighlight.wrapperStart
                + token.length
                + 3;
            editor.setSelection(
                editor.offsetToPos(contentStart),
                editor.offsetToPos(
                    contentStart + existingHighlight.content.length,
                ),
            );
            editor.focus();
            return;
        }

        const selection = editor.getSelection();

        if (selection.length === 0) {
            new Notice("Select some text first.");
            return;
        }

        if (selection.includes("\n")) {
            new Notice("Select text from one line at a time.");
            return;
        }

        if (containsUnescapedClosingMarker(selection)) {
            new Notice("The selected text contains an unescaped == marker.");
            return;
        }

        const selectionStart = editor.posToOffset(editor.getCursor("from"));
        const selectionEnd = editor.posToOffset(editor.getCursor("to"));
        const line = editor.getLine(editor.getCursor("from").line);
        const lineStart = editor.posToOffset({
            line: editor.getCursor("from").line,
            ch: 0,
        });
        const overlapsHighlight = parseHighlights(line, lineStart).some(
            (highlight) =>
                selectionStart < highlight.wrapperEnd
                && selectionEnd > highlight.wrapperStart,
        );

        if (overlapsHighlight) {
            new Notice("Change or remove the existing highlight first.");
            return;
        }

        const replacement = formatHighlight(color.id, selection, styleId);
        editor.replaceSelection(replacement);

        const token = formatHighlightToken(styleId, color.id);
        const contentStart = selectionStart + token.length + 3;
        editor.setSelection(
            editor.offsetToPos(contentStart),
            editor.offsetToPos(contentStart + selection.length),
        );
        editor.focus();
    }

    private hasHighlightsForRemoval(editor: Editor): boolean {
        const from = editor.posToOffset(editor.getCursor("from"));
        const to = editor.posToOffset(editor.getCursor("to"));
        return createHighlightRemovalPlan(
            editor.getValue(),
            from,
            to,
        ).removed > 0;
    }

    private removeSelectedHighlights(
        editor: Editor,
        showNotice: boolean,
    ): number {
        const from = editor.posToOffset(editor.getCursor("from"));
        const to = editor.posToOffset(editor.getCursor("to"));
        const plan = createHighlightRemovalPlan(
            editor.getValue(),
            from,
            to,
        );

        if (plan.removed === 0) {
            if (showNotice) {
                const message = editor.somethingSelected()
                    ? "No colored highlights were found in the selection."
                    : "Place the cursor inside a colored highlight.";
                new Notice(message);
            }

            return 0;
        }

        editor.transaction({
            changes: plan.changes.map((change) => ({
                from: editor.offsetToPos(change.from),
                to: editor.offsetToPos(change.to),
                text: change.text,
            })),
        });
        editor.setSelection(
            editor.offsetToPos(plan.selectionStart),
            editor.offsetToPos(plan.selectionEnd),
        );
        editor.focus();
        return plan.removed;
    }

    private installClearFormattingIntegration(): void {
        const registry = (
            this.app as unknown as { commands?: CommandRegistry }
        ).commands;

        if (!registry) {
            return;
        }

        for (const commandId of CLEAR_FORMATTING_COMMAND_IDS) {
            const command = registry.commands[commandId];

            if (!command) {
                continue;
            }

            if (command.callback) {
                const originalCallback = command.callback;
                const wrappedCallback = () => {
                    const editor = this.app.workspace.activeEditor?.editor;

                    if (editor?.somethingSelected()) {
                        this.removeSelectedHighlights(editor, false);
                    }

                    return originalCallback();
                };

                command.callback = wrappedCallback;
                this.register(() => {
                    if (command.callback === wrappedCallback) {
                        command.callback = originalCallback;
                    }
                });
            }

            if (command.editorCallback) {
                const originalEditorCallback = command.editorCallback;
                const wrappedEditorCallback: typeof originalEditorCallback = (
                    editor,
                    context,
                ) => {
                    if (editor.somethingSelected()) {
                        this.removeSelectedHighlights(editor, false);
                    }

                    return originalEditorCallback(editor, context);
                };

                command.editorCallback = wrappedEditorCallback;
                this.register(() => {
                    if (command.editorCallback === wrappedEditorCallback) {
                        command.editorCallback = originalEditorCallback;
                    }
                });
            }
        }
    }

    private findExistingHighlight(
        editor: Editor,
        contextOffset: number | null,
    ): HighlightRange | null {
        const from = contextOffset
            ?? editor.posToOffset(editor.getCursor("from"));
        const to = contextOffset
            ?? editor.posToOffset(editor.getCursor("to"));
        const position = editor.offsetToPos(from);
        const line = editor.getLine(position.line);
        const lineStart = editor.posToOffset({ line: position.line, ch: 0 });
        const highlights = parseHighlights(line, lineStart);

        if (contextOffset !== null || from === to) {
            return findHighlightAt(highlights, from) ?? null;
        }

        return highlights.find((highlight) =>
            from >= highlight.contentStart
            && to <= highlight.contentEnd
        ) ?? null;
    }

    private processReadingViewHighlights(element: HTMLElement): void {
        const marks = Array.from(element.querySelectorAll("mark"));

        if (element.matches("mark")) {
            marks.unshift(element);
        }

        for (const mark of marks) {
            if (mark.classList.contains("ez-highlighter-reading-view")) {
                continue;
            }

            const text = mark.textContent ?? "";
            const separator = text.indexOf("|");

            if (separator <= 0) {
                continue;
            }

            const token = parseHighlightToken(text.slice(0, separator));

            if (!token) {
                continue;
            }

            this.removeTextPrefix(mark, separator + 1);
            mark.classList.add(
                "ez-highlighter-highlight",
                "ez-highlighter-reading-view",
                `ez-highlighter-highlight--${token.styleId}`,
                `ez-highlighter-${token.colorId}`,
            );
        }
    }

    private removeTextPrefix(element: Element, length: number): void {
        const document = element.ownerDocument;
        const showText = document.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
        const walker = document.createTreeWalker(element, showText);
        let remaining = length;
        let node = walker.nextNode();

        while (node && remaining > 0) {
            const textNode = node as Text;
            const removed = Math.min(remaining, textNode.data.length);
            textNode.deleteData(0, removed);
            remaining -= removed;
            node = walker.nextNode();
        }
    }

}
