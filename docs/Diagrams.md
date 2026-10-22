# Diagrams

Pele draws Mermaid source in `mermaid` and `pele` fences everywhere notes are rendered:
reading view, Live Preview, embeds, callouts, canvas cards, chat, columns, slides and script views.

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
- **Light and dark.** Colours and fonts follow Obsidian through CSS variables, including changes
  between dark and light themes. Explicit source styles can override those colours.
- **Errors** show pele's message, line, column and caret snippet in place of the diagram rather than a blank block.

## Rendering and compatibility

Pele is bundled and loaded lazily; it does not use the host's Mermaid renderer. Drawings are
cached and mounted only near the screen. No vault-trust prompt is needed: text is escaped
and JavaScript callbacks are ignored. HTML labels, Mermaid colour themes, and external
plugins such as ZenUML are not supported. Layout can differ from Mermaid.

All built-in diagram types are supported: flowchart, sequence, class, state, ER, Gantt,
git graph, pie, mindmap, kanban, timeline, journey, quadrant, XY, requirement, Sankey,
architecture, C4, block, radar, treemap, packet, info, agentflow, railroad, tree view,
Cynefin, Wardley map, event modeling, use case, Venn, Ishikawa and swimlane.

Agents can call `check_diagram({source})` before writing a note. Canvas import keeps the
`from.mermaid` API for flowchart nodes, shapes, labelled edges and groups; it uses pele's parser.
`Markdown.mermaid(source)` in script views also uses pele.

## Turning it off

Settings → Abele → Other → **Draw diagrams**. Off shows source as ordinary code.
The existing `mermaidViewer` setting key and Other transfer section remain compatible.
