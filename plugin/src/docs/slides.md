# Presentations

Presentation notes are Markdown decks viewed on a fixed canvas. This section describes the
viewing format and navigation; scripts, presenter windows and export are not implemented yet.

## Deck format

Set frontmatter `type: presentation` to open the note as a deck. `aspect` is `16:9` (default,
1280×720), `4:3` (960×720), or `9:16` (720×1280). The canvas scales uniformly to fit the tab or
presentation window; it does not reflow to phone width. `theme: default` uses Obsidian's theme;
a `theme: "[[sample-theme.css]]"` value loads a vault CSS file.

A standalone `---` line starts a new slide. Frontmatter fences, fenced code, indented code,
quoted lines and raw HTML code blocks are not separators. Write `***` for a horizontal rule
inside a slide. Empty slides are retained. The core Slides command remains separate and can
open the same separator format.

## Slide settings and regions

The first nonblank line of a slide may be `::slide{layout=split bg="[[sample-image.png]]"
dim=0.4 fit=cover class="sample-layout" autoplay}::` (write the whole marker on one line).
Layouts: `title`, `section`, `content` (default), `split`, `grid`, `image`, `quote`. In `split`,
text before regions is the shared heading; use standalone `::left::` and `::right::` lines.
In `grid`, use `::cell::` for each cell. `image` puts its embedded image or video behind its
caption. Reading mode labels actual slide markers and separators with a thin slide divider.

Pictures, video, audio, note embeds, drawings, galleries, diagrams, charts and maps use the
same Markdown syntax and renderer as an ordinary note. Other plugins' note processors remain
live. Only the current slide and its neighbours are mounted. Their processors are disposed
when they leave that cache or the deck closes.

`bg` accepts a vault wikilink, a vault path or an HTTPS URL for an image or video. `dim` is
clamped between 0 and 1; `fit` is `cover` (default) or `contain`. The `autoplay` flag attempts
video playback on entry, muted with `playsinline` for mobile WebViews. A rejected attempt offers
**Play video**. Videos and audio pause when their slide leaves. Playback with sound is manual.

## Speaker notes and CSS

A `> [!notes]` callout belongs to that slide's speaker notes, including callouts nested in public
quotes or list items. Code examples of this syntax remain ordinary code. Folded forms (`[!notes]-` and
`[!notes]+`) work too. The callout is retained in the portable deck model and source note but
is never sent to the audience renderer. Presenter view is a later stage.

A fenced `css` block anywhere in the deck adds deck CSS rather than a visible code sample.
It and the optional theme file pass through the existing `scopeCss`, rooted at this deck's
slide elements. `@import` sheets are loaded as text (vault-relative paths, HTTP(S), or CSS data
URLs), recursively expanded, and then scoped too; no browser stylesheet import is emitted.
Relative image/font URLs retain the imported sheet's base. Media, supports and layer qualifiers
are retained. Cyclic or failed imports are omitted while other rules remain usable.
This is selector scoping, not a CSS security sandbox: declaration at-rules behave as in script
views. `class=` assigns classes to a slide, so `.sample-layout` and `.sample-layout h1` can style
that slide root and its content. No separate settings file is stored;
unknown marker attributes and frontmatter properties survive the codec for later stages.
Do not rely on future `steps` or `transition` settings for viewing-stage behavior.

## Viewing and editing

**Open presentation** opens the active presentation note as a deck. **Preview presentation
beside editor** opens a second deck pane while retaining the editor. **Edit source** returns
the deck tab to Markdown; **Edit beside** adds a source editor beside it. Changes in that
editor refresh the deck without changing its current slide. A presentation source editor has
an **Open presentation** header action. The file menu also offers **Edit presentation source**.

**Play presentation** or the deck's **Play** button presents on one screen. Desktop requests
native window fullscreen through the desktop adapter; if it is unavailable the full-window
surface still works. Mobile uses a
full-window overlay with safe-area padding, not element fullscreen. **Exit** or Escape returns
to the same tab. Arrow keys, Page Up/Down, Space, Home and End navigate while the deck is
focused. On touch screens, tap the outer thirds or swipe horizontally to page. Links, media,
editable fields and live map/chart/gallery controls keep their own gestures and keys.

## Platform findings for later export

The live phone probe verified muted, inline H.264 video autoplay on entry and pause on leaving.
ECharts and MapLibre rendered inside the transformed canvas at their logical sizes; the chart's
existing resize observer and the map's own container sizing were sufficient for the tested
slides. Portrait and landscape overlays keep the fixed aspect ratio. No `zoom` replacement or
presentation-specific chart/map resize hook was needed.

On desktop, `window.print` is callable. Electron's remote current web contents also exposes
`printToPDF`; a direct probe with `{ printBackground: true }` returned bytes beginning `%PDF-`.
This confirms API availability, not finished slide export: print pagination, snapshots of live
blocks, media inlining and saving a destination are still stage 5 work. Native fullscreen uses
the window adapter because element `requestFullscreen` may remain pending in the embedded app.
On macOS the adapter uses simple native fullscreen (the whole display, without another Space);
other desktops use regular native window fullscreen. Exiting restores the window's previous mode.
The phone exposes `window.print`, but a usable print dialog or PDF route was not exercised;
mobile PDF export is not part of the viewing stage.
