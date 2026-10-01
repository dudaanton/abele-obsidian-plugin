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

A `> [!notes]` callout belongs to that slide's speaker notes. Folded forms (`[!notes]-` and
`[!notes]+`) work too. The callout is retained in the portable deck model and source note but
is never sent to the audience renderer. Presenter view is a later stage.

A fenced `css` block anywhere in the deck adds deck CSS rather than a visible code sample.
It and the optional theme file pass through the existing `scopeCss`, rooted at this deck's
slide elements. This is selector scoping, not a CSS security sandbox: global at-rules behave
as in script views. `class=` assigns classes to a slide. No separate settings file is stored;
unknown marker attributes and frontmatter properties survive the codec for later stages.
Do not rely on future `steps` or `transition` settings for viewing-stage behavior.

## Viewing and editing

**Open presentation** opens the active presentation note as a deck. **Preview presentation
beside editor** opens a second deck pane while retaining the editor. **Edit source** returns
the deck tab to Markdown; **Edit beside** adds a source editor beside it. Changes in that
editor refresh the deck without changing its current slide. A presentation source editor has
an **Open presentation** header action. The file menu also offers **Edit presentation source**.

**Play presentation** or the deck's **Play** button presents on one screen. Desktop requests
element fullscreen; if it is unavailable the full-window surface still works. Mobile uses a
full-window overlay with safe-area padding, not element fullscreen. **Exit** or Escape returns
to the same tab. Arrow keys, Page Up/Down, Space, Home and End navigate while the deck is
focused. On touch screens, tap the outer thirds or swipe horizontally to page. Links, media,
editable fields and live map/chart/gallery controls keep their own gestures and keys.
