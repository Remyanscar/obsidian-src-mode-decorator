# Obsidian Source Mode Decorator

A powerful, locally developed Obsidian plugin that transforms raw HTML exports and complex metadata blocks into beautiful, native-looking UI elements directly in Source Mode and Live Preview. 

When dealing with automated note exports or heavily structured markdown, the resulting text is often cluttered with ugly HTML comments, massive MD5 hashes, and raw callout syntax. This plugin solves that by parsing the text in real-time, auto-folding metadata, rendering beautiful UI badges, and protecting crucial sync links from accidental edits—all without touching the underlying `.md` file on your hard drive.

## ✨ Features

*   **Auto-Folding Metadata:** Automatically collapses bulky metadata blocks (e.g., `START Md5:`) using Obsidian's native CodeMirror folding the moment you open a file or switch layouts.
*   **Smart Export & Splitter Widgets:** Injects functional UI elements directly into the editor. Renders visual scissors (`✂`) for split patterns and adds a clickable export button next to blocks to trigger customizable Obsidian commands.
*   **Beautiful Callout Badges:** Converts raw callout syntax (like `> [!axiom|I.2.4]-`) into clean, colored UI chips (Type, ID, Fold Status) that automatically inherit your vault's theme colors.
*   **Invisible Shield (Change Filter):** Protects crucial structural lines from accidental keystrokes, backspaces, or pasting. It ensures your system hashes and tracking links never break due to a typo.
*   **Seamless Inline Styling:** Enhances horizontal rules (`***`) and custom underlines (`<u>text</u>`) directly in Source Mode, completely replacing the need for heavy, external regex plugins.

## 🚀 Usage

1. Open Obsidian and paste your raw export or metadata block into any note.
2. Watch the raw HTML blocks and metadata instantly fold into a single, clean UI line.
3. Scroll through your notes to see raw `[!axiom]` callouts beautifully rendered as colorful chips.
4. Click the newly injected inline **Export button** next to a block to quickly trigger your pre-configured export command.
5. Try typing or deleting characters inside the `START Md5:` or `%% [Link` lines—the plugin's invisible shield will safely block accidental edits!
6. Use `<u>your text</u>` anywhere in your vault to get instant, theme-matched underlines.

## 🛠️ Under the Hood

This plugin relies entirely on the modern **CodeMirror 6** engine, bypassing basic DOM manipulation for extreme performance:
*   Uses `EditorState.changeFilter` to intercept and cancel specific transaction changes (like typing or backspacing) when the cursor is over protected system lines.
*   Implements `foldService` and `foldEffect` combined with `requestAnimationFrame` to safely command the editor to fold specific byte ranges immediately after view instantiation.
*   Replaces standard Markdown parsing with custom CodeMirror state machines and widgets (`WidgetType`) to decorate lines (`Decoration.line`), text (`Decoration.mark`), and inject interactive DOM elements (`Decoration.widget`) dynamically.

## 📦 Local Installation

Since this is a custom local plugin tailored for highly specific structural workflows, it is loaded directly into your vault:

1. Go to your vault's plugin folder: `.obsidian/plugins/`
2. Create a folder named `obsidian-source-mode-decorator`.
3. Place the compiled `main.js`, `manifest.json`, and your `styles.css` inside this folder.
4. Restart Obsidian or refresh the Community Plugins list.
5. Enable the plugin in your settings.

---
*Developed for advanced personal vault optimization.*
