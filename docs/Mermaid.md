# Mermaid

Obsidian draws ```` ```mermaid ```` blocks at whatever size Mermaid comes out at, with no way to
zoom or move around: a large flowchart overflows the note or shrinks to unreadable text. The
plugin draws them the way GitHub does instead, and replaces Obsidian's drawing everywhere a
note is rendered — reading view, Live Preview, embeds and callouts, the chat, GitHub tabs.

## What you get

- **The width of the note.** A diagram wider than the note is scaled down to fit it; a small one
  stays at its own size. A tall one stops at most of the window's height and is scaled to fit
  under that. Nothing makes the note scroll sideways.
- **Zoom and drag inside the frame.** The buttons in the bottom right corner zoom, fit the whole
  diagram again, and pan. Drag with the mouse or a finger to move the diagram; pinch with two
  fingers to zoom. The mouse wheel zooms only with Cmd (Ctrl) held, or with a trackpad pinch —
  otherwise it scrolls the note past the diagram. With the frame focused, the arrow keys pan,
  `+` and `-` zoom and `0` fits.
- **Full screen.** The button in the top right corner opens the diagram in a dialog as large as
  Obsidian allows, fitted to it; Escape closes it.
- **Copies.** The copy button offers the source, a PNG picture on the note's background, or SVG.
- **Edit.** In Live Preview the diagram is shown as source while the cursor is in the block, as
  Obsidian does; the `</>` button in the corner puts the cursor there.
- **Light and dark.** The diagram is drawn with Mermaid's own light or dark theme, matching
  Obsidian's, and redrawn when the theme switches. A diagram that sets its own theme keeps it.
- **Errors** show Mermaid's message in place of the diagram rather than a blank block.

## How it behaves underneath

- It uses the Mermaid that ships with Obsidian (`loadMermaid()`), with Obsidian's configuration
  untouched — `securityLevel: 'strict'`, which diagrams cannot override. The only thing added
  to a diagram's source is the theme directive.
- Since Obsidian 1.13, Obsidian asks once per vault whether diagrams may be shown at all. The
  viewer never draws past that question: until diagrams are allowed, Obsidian's own prompt shows,
  and the viewer takes over the moment they are.
- Diagrams are drawn when they come near the screen, not when the note opens, and every drawing
  is kept by its source and theme — reopening a note or the full-screen view draws nothing again.
- In Live Preview the block is replaced with the viewer before Obsidian draws its own widget, so
  a diagram is drawn once, not twice.

## Turning it off

Settings → Abele → Other → **Mermaid viewer**. Off, every diagram is Obsidian's again, straight
away. The setting travels with the Other section of settings transfer.
