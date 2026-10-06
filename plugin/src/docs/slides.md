# Presentations

Presentation notes are Markdown decks viewed on a fixed canvas. This section describes the
viewing format, shared presenter mode, live blocks, agent authoring and fit inspection;
export is not implemented yet.

## Deck format

Set frontmatter `type: presentation` to open the note as a deck. `aspect` is `16:9` (default,
1280×720), `4:3` (960×720), or `9:16` (720×1280). The canvas scales uniformly to fit the tab or
presentation window; it does not reflow to phone width. `theme: default` uses Obsidian's theme;
a `theme: "[[sample-theme.css]]"` value loads a vault CSS file. The default slide type scale is
about 28 logical pixels for body text with normal tracking, with larger, tightly spaced headings, theme-accent
subheadings/emphasis, padded tables and accent-bordered quotes. Title, section and quote layouts
have their own hierarchy. All fonts and colours come from Obsidian; deck CSS/theme files override.

A standalone `---` line starts a new slide. Frontmatter fences, fenced code, indented code,
quoted lines and raw HTML code blocks are not separators. Write `***` for a horizontal rule
inside a slide. Empty slides are retained. The core Slides command remains separate and can
open the same separator format.

## Slide settings and regions

The first nonblank line of a slide may be `::slide{layout=split bg="[[sample-image.png]]"
dim=0.4 fit=cover class="sample-layout" autoplay}::` (write the whole marker on one line).
Layouts: `title`, `section`, `content` (default), `split`, `grid`, `image`, `quote`. In `split`,
text before regions is the shared heading; use standalone `::left::` and `::right::` lines.
In `grid`, use `::cell::` for each cell: up to three cells share one row; four use a 2×2 grid.
Content headings stay at the top. A plain-text content body using less than a third of the remaining
height is vertically centered below its heading; longer bodies, tables, code and embeds stay top-aligned. `image` puts its embedded image or video behind its
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
is never sent to the audience renderer. Only the presenter's notes panel renders these blocks.

Put sources in the same `> [!notes]` callout: use `[Short label](https://example.test/report)`,
reference links, `[[Sample reference|Short label]]` or `<https://example.test/report>`. Note links
are collected into an automatic final **Sources** slide, grouped by slide number/title, and the
original slide shows a small muted **Sources: N** marker. Repeated targets within one slide count
once; images and code examples are not sources. Notes still show the links to the presenter.
The appendix uses the slide body size for entries and a slightly smaller size for slide-title
headings; long addresses wrap within its columns. It is a derived part of the portable audience
model, not written into the note.
`deck_read`/`deck_edit` number authored slides only; `deck_check`, `screenshot` and `present`
also include the final rendered appendix. Do not try to edit it: edit its originating notes.
The appendix is exempt from body-density warnings, but still checked for overflow; a long
reference list may not fit a single canvas.

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
Add `steps` to the slide marker to reveal top-level list items one at a time. Nested items reveal
with their parent. Next/Space advances a step before paging; Previous reverses steps, then returns
to the previous slide with its items revealed. Direct slide selection, Home and End start at step
zero. The next-slide preview shows all its items. Steps apply in the normal viewer and in both
windows of a show.

Set frontmatter `transition: none | fade | slide` (default `none`), or override it with
`transition=fade` on a slide marker. Transitions animate slide entry for 250 ms with CSS, without
changing the canvas scaling transform. They are disabled under `prefers-reduced-motion`.

## Live blocks

A top-level `slide-script` fence takes YAML with `script: Sample report`, optional
`params: { region: west }`, and `refresh: once | enter | 60s`. It resolves a named script in
the configured scripts folder, passes through ScriptService's foreign-script trust admission,
and uses the same declared parameter defaults. Returned text appears inline; `show(markdown)`
renders Markdown in the slide instead of opening a modal. A script may also
open one `view()` whose component-kit body is mounted in the slide. Only the active audience or
single-screen slide starts a run; adjacent slides and presenter previews never do. `once` keeps
a static result after leaving, while an interactive view must be disposed and rebuilt on return.
`enter` runs on every entry; an interval refresh runs only while the slide is active. The run
receives an abort signal and the view is disposed on exit. Code using raw JavaScript global
timers outside the script view API cannot be forcibly stopped; use `view.every` or `signal`.

A top-level `slide-html` fence contains HTML for an opaque-origin iframe with **no
`allow-same-origin`**. It cannot access Obsidian, the vault, parent DOM, Obsidian cookies, popups
or forms. The frame is removed on slide exit, terminating its timers, animation and audio;
previews never start frames. Vault paths are not inlined; use Markdown embeds outside the frame.

Offline frames on both desktop and mobile use an empty sandbox (no scripts), `script-src 'none'`,
and `default-src 'none'`. Before rendering, an inert-template codec rebuilds a limited static
HTML vocabulary, discarding scripts, handlers, refresh redirects, link destinations, forms, SVG,
and nested documents. Basic text, tables, inline CSS/animation, and base64 raster images/media
remain. CSP blocks external resources. The slide labels this mode "Offline HTML — static only;
scripts disabled". This is deliberate: CSP cannot reliably block a scripted self-navigation,
and a new document would lose the srcdoc CSP. No network consent means no script execution,
not a best-effort network restriction.

`htmlNetwork: true` requests a device-local per-deck permission. Parallel blocks and audience
renderers share one pending decision. Allow, deny and dismissal are remembered. Once allowed,
the iframe gets `allow-scripts`; the initial CSP allows inline code/style and HTTPS resources.
Scripts can navigate within their own frame to other pages, which may use any web network
scheme supported by the browser under their own policy. The permission is therefore labelled
"Allow network", not an HTTPS-only guarantee. Network access never grants the vault or parent
DOM. Only enable interactive HTML for trusted content.

## Viewing and editing

**Open presentation** opens the active presentation note as a deck. **Preview presentation
beside editor** opens a second deck pane while retaining the editor. **Edit source** returns
the deck tab to Markdown; **Edit beside** adds a source editor beside it. Changes in that
editor refresh the deck without changing its current slide. A presentation source editor has
an **Open presentation** header action. The file menu also offers **Edit presentation source**.

**Play presentation** or the deck's **Play** button presents on one screen. Desktop requests
native window fullscreen through the desktop adapter; if it is unavailable the full-window
surface still works. Mobile uses a full-window overlay, not element fullscreen, and hides the
native status bar when the host provides that capability. Its previous visibility is restored
on exit. The slide fills the available canvas; safe-area insets apply to the overlaid controls,
not the slide. Controls start hidden and appear only while hovering over the top strip on
desktop, tapping a noninteractive slide area on mobile, or using Tab for keyboard access.
They fade after 2.5 seconds away from the strip or after a tap; focused controls remain visible.
Pointer movement over the slide does not reveal them. Revealing controls never resizes the
slide. **Exit** or Escape returns to the same tab. Arrow keys, Page Up/Down, Space, Home and
End navigate while the deck is focused. On touch screens, tap the outer thirds or swipe horizontally to page. Links, media,
editable fields and live map/chart/gallery controls keep their own gestures and keys.

## Presenter mode

**Present** or **Present with speaker view** starts a show at the current slide. Desktop opens
an Obsidian audience popout; drag it to the display for the audience, then use its **Fullscreen**
button, revealed by hovering over the top strip. Audience controls auto-hide as in Play, and
stay below native title-bar buttons while the window is movable. The original tab shows the
current slide, next slide, rendered speaker notes, a slide selector and elapsed timer. Pause/resume and reset affect only the timer, not navigation.
Preview media is paused; autoplay runs only in the audience view. Both windows share one
in-memory navigation/step state, with no server or messaging transport. Source edits refresh
both views and the notes panel without moving the current slide.

Arrows, Page Up/Down and Space work from either window; Home/End jump within the shared show.
Editable fields and live controls still keep their keys. **End show**, the audience's **Exit**,
Escape, closing the audience window or closing/replacing the presenter tab end the whole show.
The audience popout closes and the presenter returns to its ordinary deck tab. Native fullscreen
is resolved after the view is adopted into the popout's document, so it targets the audience
window, not the window in which the view was initially constructed.

Mobile uses a local, safe-area-aware full-window presenter with the same notes, timer and
previews. **Present** opens it directly; holding a noninteractive slide area for at least 600 ms
and releasing also opens it from Play. It does not create a second screen or remotely control a
desktop: a cross-device transport is outside this stage.

## Make a deck from a note

This is the presentation-authoring skill, available without a vault skill installation through
`query_docs({section: "slides", topic: "make-a-deck-from-a-note"})`.

1. Read the source note with `read`. Determine the purpose, audience and desired length from the
   request. Preserve facts and cite source links; do not invent missing figures. Ask only when
   the answer changes the deck. Keep the source note unchanged unless explicitly asked.
2. Plan a short outline: title, context, one idea per slide, supporting evidence, conclusion.
   Keep body text to about 40 words, at most 5 bullets, and tables to 5 data rows × 3 columns
   with short cells. Put long explanations in `> [!notes]` or on another slide, not tiny text.
   No links/URLs in the slide body: put source links in `> [!notes]` for the automatic appendix.
   Choose `layout=section` for one-line statements and another built-in layout for each other
   idea; do not write deck CSS, colours or fonts unless asked. Reuse in-scope pictures/drawings and their
   existing embed syntax. A screenshot is not a substitute for checking the facts.
3. Use `deck_create` for a new note, or `deck_read` before `deck_edit` on an existing deck.
   For a large deck follow each `nextOffset` with `deck_read.offset` until it is `null`;
   structural summaries are not complete reads.
   The new deck uses `type: presentation` and `---` separators. A slide edit includes that
   slide's full layout and speaker notes. Named script/HTML fences follow **Live blocks**;
   never store or claim network consent. Ordinary write approval is still required.
4. Run `deck_check` on every slide and inspect each slide with `screenshot({path, slide: N})`.
   These render at the fixed logical size, with all steps revealed and no notes. Fix overflow,
   missing/clipped media and authoring warnings (word/bullet/table limits, body links/URLs,
   deck CSS fonts/literal colours); fix warnings or explain why they were kept. Use `deck_edit` to shorten, change layout or
   insert another slide. Repeat both the measurement and the visual check on changed slides.
   A zero-issue check alone does not prove readable composition or factual correctness.
5. State what you checked. Never call live scripts/HTML verified by a nonexecuting preview;
   they are placeholders and must be seen in a user-started show. Other plugins' executable
   blocks are inert in agent previews too. If a tool is Off, explain which check could not be
   made rather than pretending to have seen the slide. Use `present` only when asked to show
   the deck; it opens a normal tab, which may activate its trusted live content.

## Deck template

A title plus four content slides is a starting point, not a required length. Create it with
`deck_create({path: "Decks/sample-deck.md", content: "…"})`, replacing the sample text:

```markdown
---
type: presentation
aspect: '16:9'
---
::slide{layout=title}::
# Sample deck
A short introduction

---
::slide{layout=content}::
## Context
- One useful point

> [!notes]
> Supporting detail for the speaker.

---
::slide{layout=split}::
## Evidence
::left::
- Explain what the picture supports
::right::
![[sample-image.png]]

---
::slide{layout=content}::
## Main idea
- One idea, with evidence

---
::slide{layout=section}::
## Conclusion
One takeaway
```

Use a real existing media path or remove the placeholder embed. To keep a reusable vault
**template**, replace frontmatter `type: presentation` with `type: template`,
`template_for: presentation`, `template_for_type: presentation`, and `template_for_aspect: '16:9'`.
The ordinary `list_templates`/`apply_template` flow then creates a presentation. To keep a vault
**skill**, make a note with `type: abele-skill`, `name: Make a presentation`,
`description: Build and visually check a deck from a note`; put the workflow above in its body
and offer it to the agent through the usual skills folder/scope. No vault files are installed
silently. Copyable examples are in the repository's `docs/examples/`.

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
