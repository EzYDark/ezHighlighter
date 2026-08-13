> [!CAUTION]
> **Prototype only — this project was vibe-coded.** It is not intended to be
> maintained or treated as production-ready software. Use it as an experimental
> prototype and keep backups of important notes.

# ezHighlighter

ezHighlighter splits Obsidian's existing **Format → Highlight** context-menu item
into two simple, theme-aware choices:

- **Text highlight** colors only the text, with no background.
- **Background highlight** adds a stronger colored background while retaining
  the theme's normal, readable text color.

## Use

1. Select text on one line.
2. Right-click and open **Format → Highlight**.
3. Choose **Text highlight** or **Background highlight**, then choose a color.

Right-click highlighted text to change its color or remove the highlight.
Select any larger range—even multiple mixed lines or the entire note—and use
**Remove highlight** to clear every custom highlight in that selection at
once. Plain text and ordinary Obsidian `==text==` highlights are untouched.
The highlighted text remains directly editable in Live Preview.

ezHighlighter also integrates with Obsidian's **Clear formatting** and Editing
Toolbar's **Clear Text Formatting** commands. Those commands remove custom
highlights together with the other formatting in the selected range, without
modifying Editing Toolbar itself.

## Editing Toolbar integration

ezHighlighter registers standard Obsidian commands, so no direct dependency on
Editing Toolbar is required.

In **Settings → Editing Toolbar**, add this command to the Following toolbar:

**ezHighlighter: Choose highlight style and color…**

It opens the same theme-color palette beside the current selection or caret.
For one-click color buttons, add any of these commands instead:

- **ezHighlighter: Text highlight with Pink** (and the other palette colors)
- **ezHighlighter: Background highlight with Pink** (and the other colors)
- **ezHighlighter: Remove highlight(s)**

Editing Toolbar can also group the individual color commands into one of its
submenus. To keep Obsidian's ordinary `==text==` highlight as a separate
toolbar action, add the built-in **Highlight** command alongside ezHighlighter.

## Markdown format

ezHighlighter uses compact, readable extensions of Obsidian's native highlight
syntax. Existing text highlights retain their original format:

```markdown
==pink|Android users==
```

Background highlights add a short `bg-` prefix:

```markdown
==bg-pink|Android users==
```

The supported color names are `pink`, `red`, `orange`, `yellow`, `green`,
`cyan`, `blue`, `purple`, and `grey`.

Without the plugin, Obsidian still recognizes the surrounding `==` as a
normal highlight and shows the short color prefix. No HTML is generated.

## Development

```shell
npm install
npm test
npm run build
```

Every build writes only to `export/ez-highlighter/`. The project root stays
source-only. For continuous rebuilding while editing, run:

```shell
npm run dev
```

That command watches the source and refreshes the export folder. `npm run
build` runs the tests and type checker before creating a minified production
build.

The regression suite covers parsing, multi-selection clearing, partial
deletion, full-line cutting, marker repair, and replacing highlighted text.

## Exporting the plugin

Create a clean, ready-to-copy production plugin folder with either:

```shell
npm run build
# or
npm run export
```

The final Obsidian files are written to:

```text
export/ez-highlighter/
├── main.js
├── manifest.json
└── styles.css
```

Copy the entire `ez-highlighter` folder into your vault's
`.obsidian/plugins/` directory, then reload Obsidian and enable
**ezHighlighter** under **Settings → Community plugins**.

## Creating a release ZIP on Windows

Run or double-click:

```text
_scripts/build-release.bat
```

The script validates and exports the plugin, then creates a versioned archive:

```text
export/ez-highlighter-v1.0.0.zip
```

The ZIP contains the complete `ez-highlighter` folder. Extract it directly
into the vault's `.obsidian/plugins/` directory.
