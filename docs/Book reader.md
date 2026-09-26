# Book reader

Abele opens books from the vault in a tab of their own — EPUB, Mobipocket and Kindle (`.mobi`,
`.azw`, `.azw3`), FictionBook (`.fb2`, and zipped as `.fbz`) and comic book archives (`.cbz`) — and
PDFs when asked (see [PDF](#pdf)). Such a file opens in the reader when it is clicked in the file
explorer, on the desktop and on phones alike.

If another plugin already opens one of these extensions, Obsidian keeps that one for it, and the
others still come here; the console says which.

## Reading

A book opens where it was left. The first time, it opens on its first chapter of text (the cover
and front matter are skipped when the book says where the text starts).

- **Turning pages.** The arrow keys, Page Up and Page Down, the space bar, a tap near the left or
  right edge of the page, or on a touch screen a swipe. Only a clean tap or swipe turns: not a
  long press, not a finger held and then moved, not the mouse let go after a drag — words just
  selected, wherever the button is released, the edge included; a press that wanders more than a
  few pixels is a drag, not a click — not a tap while words are selected (except on the very edge,
  which carries them on — see below) or a bar is open (that tap only closes the bar), not a tap on a highlight, a picture or a table.
- **Pages or scrolling.** The pages can be turned one at a time or scrolled through a chapter at a
  time. The tab's menu (⋯) switches between the two at once, keeping the place; so does
  **Layout** in the text and layout settings.
- **Contents.** The list button in the tab's header opens the book's table of contents beside the
  page, with the chapter on screen marked and the way to it opened. On a narrow tab or a phone it
  is a drawer over the page, which closes when a chapter is picked. Whether it is open is
  remembered on the desktop.
- **Notes.** A tap on a note mark opens the note in a dialog over the page, as in Apple Books.
  Marks the book labels as notes (EPUB 3 `noteref`) are recognised, and so are the plain
  superscript numbers older books use. **Go to the note** turns to it in the book. Notes printed
  as asides inside the text are hidden there, since they open in the dialog.
- **Links.** A link to another place in the book goes there; the arrow at the start of the line
  under the page goes back to where the link was followed from. Links to the web open in the
  browser.
- **Progress.** The line under the page names the chapter, and beside its slider a measure of
  where the page is: **Page 3 of 12** in the chapter, **9 pages left in chapter**, **Loc 120 of
  830** in the whole book, or the percentage. A tap on it goes to the next of these, and the one
  chosen is kept (it travels with the settings). A page is what is on screen at once — two side
  by side count as one, and in a scrolled chapter a screen's height — so pages change with the
  text's size; a location does not: there is one for every 1500 bytes of the book's text, the
  measure Foliate itself shows. A PDF shows its own page numbers in the chapter's place. The
  slider goes anywhere in the book; on a phone dragging it never opens Obsidian's
  side panel.
- **Where it was left** is kept for each book under its identifier, so renaming or moving the file
  keeps it. It is kept in a file in the vault, `abele-book-places.json` at its root unless set
  otherwise (**Reading places file**, below), so it reaches every device the vault is synced to.
  It is written a moment after the last page turn, and at once when the app is hidden or quits,
  with a copy on this device written just before, so a write cut short by the app being stopped
  never loses it. Every device writes the one file, and none ever puts an older place over a
  newer one: each book keeps the place read last, wherever it was read. A later place arriving
  from another device while the book is open here moves the book on to it, and says so.
- **Bookmarks.** The bookmark at the end of the line under the page marks the page on screen; it
  is filled while the page has one, and a second tap removes it. The side panel's **Bookmarks** tab
  (also **Bookmarks** in the tab's ⋯ menu) lists them in the book's order — each with its chapter (a PDF: its page), the first words of the
  page and the day it was made, the ones on the page on screen marked at the edge. A tap goes
  there; the bin removes one. A bookmark belongs to the words at the top of its page, not to a
  page number, so it stays with them when the text size or the window changes. They are kept like
  the places, in `abele-book-bookmarks.json` beside the places file, and reach every device the
  same way: each device's bookmarks are merged one by one, and one removed on any device stays
  removed. The agent sees them, read-only, with what is on screen.
- **Pictures and tables.** A picture that stands alone on the page is centred. A table wider than
  its column scrolls sideways in place. A tap on a picture or a table opens it full screen:
  pinch, Mod with the wheel, the buttons or plus and minus zoom; a drag moves it; a double tap
  zooms in on a spot and back; the middle button or 0 fits it again; a swipe down (while it is
  fitted), Escape or the close button closes it. Small pictures among the words — icons,
  letters — are left alone. A table is shown in a frame that runs nothing, like every page.

## Highlights, links and search

**Selecting words** on the page — with the mouse, or a long press on a phone — brings up a bar
under the page, in the place of the line with the slider:

- a colour highlights them (yellow, green, blue, pink, purple, orange);
- the speech bubble highlights them and opens a box for a comment;
- the link copies a link to the words;
- the quote writes the words, with a link to them, into the note last worked in;
- with scripts on, a button for each script whose header has `// @book`, and **Run a script on
  these words**, which picks any script (see **Scripts on words** below).

A **tap on a highlight** brings up the same bar for it: another colour, the comment, a link, the
quote, the highlights note, or remove it. A tap beside the bar closes it.

**A selection can run on past the page.** While words are selected, the page moves on under
them by **half a page**, not a whole one, so the words just selected stay on screen beside the ones
coming:

- **A tap on the very edge of the page** — its outer sixth, left or right — moves it on (right)
  or back (left) by half a page. The selection is kept: if its end has gone off screen it moves to
  the first word on it, going back its start to the last word, drawn again with its handles to
  drag on from there. A tap anywhere else still turns nothing, and a tap on the edge with nothing
  selected turns a whole page as always.
- **A handle dragged to the foot of the page and held there** for a moment — its line in the
  lowest eighth of the page, on its last word, or past the text — moves it on the same way, and
  again each time it is dragged back down there and held; the start held at the head of the page
  goes back. With a mouse, or wherever the page hears the finger move, the pointer held at the
  bottom or right edge does the same, and at the top or left edge goes back. A selection just made
  by a long press does not move the page: only an end that was dragged there does. On a PDF page,
  which a selection never leaves, the pointer held at the edge says so instead.

How "half a page" looks depends on the page:

- **Pages of two columns** move by one column: the second column of one page beside the first of
  the next, every line whole.
- **Pages of one column** — a phone — cannot: half a column shows the ends of one page's lines
  beside the starts of the next page's, every line cut. So while the selection is carried on, the
  chapter is scrolled instead, in the page's own box and at the same width, so no line of it wraps
  differently or moves, and each step scrolls half the page's height.
- **A chapter scrolled** by choice moves half the screen's height.

Once the selection is let go — highlighted, quoted, cleared — the pages come back on the page
where it ended; not as soon as its bar shows, which would move the words just as they are about to
be used.

While the selection is being made — a finger or the mouse still at it — **the bar for the words
is hidden**, and the line with the slider shows. The bar comes back once the selection has rested
for half a second (and the mouse button is up), and a second longer after the page has moved: iOS
tells a page nothing while a handle is dragged, so resting is the only sign a finger has stopped.

**The row under the page holds one thing at a time**, and is as tall whatever it holds: the bar for
words selected or a highlight tapped, else the bar for reading aloud while it reads, else the line
with the chapter and the slider. So nothing stands over the text and the page is never laid out
anew for a bar. The bar for words wins over the one for reading aloud: it is there only while
words are selected, and reading goes on underneath. Its buttons fit a phone's width in one row;
on a narrower pane what does not fit scrolls sideways.

The selection is kept through every page turn and shown again, with its handles, on any page it
reaches — iOS keeps a selection through a turn but stops drawing it, so the reader sets it again.
A selection stays on the pages it has been shown on: a handle dragged off the text stops at the
page's last word instead of running to the end of the chapter. The selection is one range of the
chapter and is highlighted, linked and quoted as one. It stops at the end of its chapter, and says
so; in a PDF or a book of fixed pages each page is a document of its own, and a selection stays on
its page.

**Highlights live in a note beside the book** unless the settings send them elsewhere (see **Where highlights go** below), `<book> highlights.md`, made with the first one:

```markdown
---
type: book-highlights
book: "[[Books/Dune.epub]]"
---

# Dune

> [!quote|green] [[Books/Dune.epub#cfi=/6/8!/4/2,/1:0,/1:22|Chapter 3]]
> Fear is the mind-killer.
>
> My comment on it.
```

One quote callout per highlight, in the order of the book: its title is a link to the place, named
after the chapter (a PDF: the page); its first paragraph the highlighted words; what follows a blank
line inside it the comment; its colour the callout's metadata, which Obsidian draws as an ordinary
quote. The note is ordinary — searchable, on the graph, readable on a phone without the plugin — and
it can be edited by hand: a callout changed, added or deleted there changes what the open book draws
at once. The reader finds the note by its `book` property, which Obsidian updates when the book is
renamed or moved, so the two stay together. Anything else written in the note is left alone.

**Links to places** work the way links to lines of a note do: the place rides where a heading would.

```
[[Books/Dune.epub#cfi=/6/8!/4/2,/1:0,/1:22|Chapter 3]]   words in a book (EPUB CFI)
[[Papers/Paper.pdf#cfi=/6/2!/4/4/10,/1:4,/1:15|Page 1]]  words in a PDF
[[Papers/Paper.pdf#page=4]]                              a page of a PDF
```

A click opens the book there with the words selected. Brackets and other characters a link cannot
carry are percent-encoded. `#page=N` is what Obsidian's own PDF viewer reads too, so such a link
opens a PDF on its page wherever PDFs open; a link to words in a PDF always opens in the reader,
which is the only one that knows the place. Without the plugin every one of these links still opens
the file. **Copy link to this place** (or **to this page** in a PDF) is in the tab's ⋯ menu.

**Notes linking to a place are marked there.** Any note whose text or properties link to words
in the book (`#cfi=…`) has those words drawn with a dotted underline in the theme's accent — not a
highlight's fill, not a discussion's solid line and bubble. A tap on them opens the note in a new
tab, flashing the line the link is on; when several notes link there, a menu names them. The
book's highlights notes and its discussions are left out: they have marks of their own. A link to
a page as a whole (copied with nothing selected) is marked by its first word only, so the page can
still be tapped to turn. Which notes link to a book is read once from Obsidian's link index when
it opens and kept up to date note by note as Obsidian re-reads one; a place is resolved only for
the chapter on screen. Links to a page of a PDF (`#page=N`) name no words and are not marked.

**Scripts on words.** The script is run with `book` in its scope — the words, the whole sentence
they are in (the same sentence rules reading aloud uses), a link to the place as **Copy link**
makes it, the book's path and title, the chapter, the CFI — and a parameter marked `selection`
starts out as the words. Its form shows only when a required parameter is still empty, so a
script needing nothing more runs at one tap. The run is listed with the source *book*, and
running it again from the list gives it the same words. A script that makes a note holding
`book.link` — a card for a word, say — is then marked in the book as above.

**Search** — the magnifier in the header, Mod+F, or the ⋯ menu — opens a search in the side panel.
It goes through the whole book or PDF a moment after typing stops, listing what it finds chapter by
chapter (page by page in a PDF) as it goes, with the words around each find; in a book the finds on
the page on screen are outlined. A find goes to its place and selects the words. The side panel
switches between **Contents**, **Search** and **Highlights**, the list of the book's highlights with
their comments, each going to its place.

## The agent

A chat can read books and PDFs the way it reads notes, and only the ones its scope lets it read:
a book is a file of the vault, and a book outside the chat's scope is refused, the same as a
note. The tools are read-only — `book_views` (what is open and selected), `book_contents`,
`book_read` (a part's text, a window at a time, or from a place), `book_search` and `book_open`
(shows the person a place, the words selected) — and are described for the agent in its
reference (`src/docs/tools.md`). They open the file themselves, so the book need not be open in
a tab; a book read is kept for a few minutes so reading it a part at a time does not parse it
again. The agent answers with links to places, which open the book there.

- **Ask here** — the speech bubble with a plus on the bar under selected words (or a highlight)
  starts a **discussion** kept with those words, the way a comment chat is kept with a passage in
  a note. The chat opens in the AI sidebar; the words are marked in the book with a small speech
  bubble (underlined in the theme's accent, or over their highlight if they have one) and listed
  in the highlights note with a link to the chat. A tap on the marked words — or Ask here on them
  again — opens the same chat, after a restart or on another device as well. The chat is the
  comment agent's, told the book, the place, the words and the text around them every turn, with
  the book in its scope and the book tools that only read (`book_views`, `book_contents`,
  `book_read`, `book_search`, `book_open`) whatever its agent's own tools, needing no approval.
  Ask here inside its chat asks a nested question like in any comment, the book at the root of the
  trail. Its "back to the passage" opens the book at the words. The highlights
  panel lists discussions with the rest, a way into each chat, and can show only discussions or
  only highlights. Removing the mark asks what becomes of the chat: kept as an ordinary chat in
  the history, or deleted. PDFs and fixed-layout books work the same, the mark drawn over the
  page. Nothing is written into the book file.
- **Chat about this** in a book tab's ⋯ menu does the same with a link to the place on screen.

Both let that chat read this one book, if its scope did not already reach it — the grant **Chat
about this** gives a note. They are offered only while the AI agent is on.

## Reading aloud

The speaker button in a book's header reads the book aloud from the page on screen, with the
device's own speech — on an iPhone or iPad the voices of its Spoken Content settings, on a Mac the
system voices. **Read aloud from here** on the bar under selected words starts at those words.

- It reads a sentence at a time and marks the one being read: a highlight in a book, a box over the
  words on a PDF page or a fixed page. The page turns to follow it.
- At the end of a chapter or a PDF page it goes on into the next one, to the end of the book.
- A bar under the page, in the place of the line with the slider while it reads, pauses and goes on, reads the last sentence again, skips to
  the next, opens the voice and speed settings and stops.
- Closing the tab, or the book, stops it.

Two settings, with the others under **Aa** and in **Settings → Abele → Books**, travel with the
settings transfer: **Voice** — the device's voice for the book's language by default, or a
chosen one (a voice chosen on another device and missing on this one falls back to the default)
— and **Speed**, 0.75× to 2×.

Hidden text is not read: notes that open in a dialog, what the cleaning removed. Where the
platform has no speech the button says so. An iPhone starts speech only from a tap, which is how
both ways of starting it work.

## Text and layout

The **Aa** button in a book's header opens the text and layout settings over the page; the same
settings are in **Settings → Abele → Books**. Every change is applied to the open books at once
and travels with the settings transfer.

| Setting | What it does |
|---|---|
| Layout | Pages turned one at a time, or scrolling through each chapter. |
| Font | The theme's text font (the one notes use), a serif, a sans-serif, or the book's own. |
| Text size | 70% to 200% of the book's own. |
| Line spacing | 1.2 to 2, or the book's own. |
| Margins | Narrow, normal or wide space around the text and between columns. |
| Column width | The widest a column of text may grow. |
| Two columns | Two pages side by side when the tab is wide enough. |
| Theme colours | On: the book in the theme's text, link and background colours, dark mode included — in a dark theme pictures sit on white paper, so diagrams drawn as dark lines on transparency still show. Off: the book's own colours on a light page. |
| Voice | The voice reading aloud: the device's own for the book's language, or one chosen. |
| Speed | How fast it reads aloud, 0.75× to 2×. |
| (the measure under the page) | Page of the chapter, pages left, location in the book, or percent — changed by tapping it. |
| Reading places file | In Settings only: the `.json` file in the vault where each book was left is kept, `abele-book-places.json` at its root by default. Changing it moves the places to the new file; a file that holds something else is left alone and the places stay where they were. The bookmarks file, `abele-book-bookmarks.json`, follows it to the same folder. |

Why a `.json` file, and where: Obsidian's file list shows no `.json` file, so it stays out of
sight among the notes, and Obsidian Sync carries it once **Sync all other types** is on — the same
switch chats (`.abchat`) need. A hidden file or folder (a name starting with a dot) would be out of
sight too, but Obsidian Sync never carries one, so the path may have no part starting with a dot.
The places were kept in the plugin's own folder before, which Obsidian Sync does not carry beyond
the plugin's settings; the first time the plugin loads they are moved into the vault's file,
merged with it.

On a phone the text starts just under Obsidian's header and the line under the page sits above its
navigation bar.

## Where highlights go

**Settings → Abele → Books → Highlights** says it for every book; a book's own **Aa** dialog, under
**Highlights of this book**, for that book alone, where **As in settings** and empty fields follow
Settings. Both are plugin settings, so they reach every device the settings do, and travel with
the settings transfer; a book is known by its identifier, as for its place, or by its path, which
follows a rename.

| Setting | What it does |
|---|---|
| Where they go | **A note of the book's own**, beside it (as above), or **one note for every book** — a book's own dialog calls it **a note you name**. |
| Note | The note they go to when it is one note: `Book notes.md` at the vault's root by default. Made, folders too, with the first highlight. |
| Template | A note new highlights notes are made from; empty for none. |

**A shared note** holds the highlights of several books; each book shows the callouts whose link
goes to it, so two books never mix even at the same place. New ones are added at the end, like a
journal, and without a template their link reads `Dune · Chapter 3`, so it says which book.

**A template** is an ordinary note, in the plugin's template language:

```markdown
---
tags: [reading]
book: "{{ book }}"
---
# {{ title }}, {{ author }}

{{#body}}
## {{ chapter }} · {{ date }}
{{ highlight }}
{{/body}}
```

The first highlight makes the note from all of it, the body written for that highlight where the
body stands. After that only the body is added, at the end of the note. `{{ highlight }}` is the
callout the reader reads back, on a line of its own; a body without it gets the callout at its end,
and a line right after it gets a blank line in between, or it would join the quote. Filled in:
`{{ title }}`, `{{ author }}`, `{{ book }}` (a link to the book), `{{ chapter }}`, `{{ color }}`,
`{{ link }}` (to the place), `{{ date }}` and `{{ date.format('D MMMM YYYY') }}`; anything else is
left as written. A template without `{{#body}}` is written once and each highlight is added at the
end. A book's own note made from a template still gets `type: book-highlights` and `book:` if the
template does not set them, so it is found again after either file moves. A template that is not
there is said, and the highlight is written without it.

Recolouring, a comment, or removing a highlight happens where the highlight is. Removing one takes
the lines its body wrote around it too, while they still read as the template wrote them — a
heading changed by hand stays. Changing where highlights go leaves the ones written before where
they are: the book keeps showing the ones in its own note and in the notes the settings name (the
one for every book and its own), and changes them there. A note that is no longer named anywhere
is not read.

## PDF

PDFs open in the same reader, drawn by the PDF.js that Obsidian itself ships (`loadPdfJs()`), so
nothing is added to the plugin for it and the same library is on the phone. A `.pdf` opens here
by default, however it is opened — the file explorer, a link, the quick switcher:

- **Open PDF files in the Abele reader** in Settings → Abele → Books, on by default: every PDF
  opens here, and tabs showing one in Obsidian's viewer — those brought back from the last
  session — move here as the plugin starts or the setting is turned on. Turned off, `.pdf` goes
  back to Obsidian's viewer. Obsidian lets one view own an extension and refuses a second claim, so
  this goes through its view registry (not part of the plugin API); if a future Obsidian changes
  it, the setting does nothing and the menu item below still works. The setting was called
  `openPdf` and was off by default until 2026-09-26; the settings are saved whole, so that stored
  `false` was the default rather than a choice, and the new key `pdfInReader` does not read it.
- **Open in Abele reader** in a PDF's menu — in the file explorer, or the ⋯ menu of a PDF that is
  open in Obsidian's viewer.

A PDF is read as **one continuous scroll**, page under page, by default, or as **pages turned one
at a time** — keys, a tap at the edge, a swipe on a phone. **Layout** in the settings, or the tab's
⋯ menu, switches between the two at the same page. In the scroll only the pages near the screen
are drawn, so a long PDF costs what a few pages cost; each page keeps its own size.

Around either: the place it was left on kept per file, across renames; the outline in the same
contents panel as a book's; the page number and the outline entry under the page with a slider
through the document; highlights, links to places and search, as in a book; and, in a dark theme,
pages with light and dark swapped (**Dark pages in a dark theme**, on by default; pictures come
out as negatives). Text on the page can be selected and copied, links inside the document go to
their page, and links to the web open in the browser.

**Zoom.** Under the page, beside the pen: **−**, the scale (a tap offers **Fit the width**, **Fit
the page** and **Zoom as set**) and **+**; on a phone one magnifier holds all of them. The same are
in the tab's ⋯ menu, and on the keys Mod and plus or minus, Mod+0 going back to the **Page size**
setting. A pinch — two fingers on a touch screen, a trackpad's pinch, Ctrl with the mouse wheel —
follows the fingers and keeps the place under them where it is; also while drawing, where two
fingers zoom and move the pages and one finger does what it did. Zoomed past the screen's width, the
pages scroll sideways too; with pages turned one at a time a swipe then moves the page rather than
turning it (a tap at the edge still turns it).

During a pinch the pages are only stretched as a picture; when it ends the zoom is set once and the
pages near the screen are drawn again at the new size, sharp — each page with at most 8 million
pixels, so a tablet zoomed far in draws a little soft instead of running out of memory. Until a page
is drawn again it shows the old picture stretched, never a jump. The words under the page (the text
layer), highlights and ink are all inside the page, so they stay on their place at any zoom.

The zoom chosen is kept per book **on this device** (the app's local storage, the last 200 books),
not synced with the place: another device's screen is another size. **Zoom as set** forgets it.

| Setting | What it does |
|---|---|
| Layout | Continuous scroll (the default), or pages turned one at a time. |
| Page size | Automatic (the default): the page's width in the scroll, the whole page with pages. Or the whole page fitted in the tab, the page's width fitted, or 100%, 125%, 150% or 200%. A size chosen before this setting had Automatic stays as it was. |
| Two pages side by side | With pages turned one at a time: two at once when the tab is wide enough, as a printed book lies open. Off by default. |
| Dark pages in a dark theme | See above. |

The text settings (font, size, spacing, margins, columns) do not apply to a PDF, whose pages are
pictures of a fixed layout; the **Aa** dialog of a PDF shows only its own.

**Nothing in a PDF runs either.** PDF.js runs PDF JavaScript only when given a scripting sandbox,
which the reader does not give it; fonts are not compiled with `eval`; XFA and form fields are not
drawn. Each page is a page the reader writes — the same Content Security Policy first in its head,
the same audit when it loads — holding a picture of the PDF page and its text laid over it as
plain text. A link out of the document gets an address only if it is `http(s):` or `mailto:`;
PDF.js itself drops `javascript:`, `file:` and launch actions before that. The hostile PDF in
`tests/fixtures/books/pdfFixture.ts` carries all of those and is opened by the e2e tier with both
sandboxes.

### Drawing on the pages

The pen at the start of the line under a PDF's page (or **Draw on the pages** in the tab's ⋯ menu)
turns drawing on. While it is on, a sheet lies over the pages and takes every touch: the reader's
own taps, swipes and selection, and Obsidian's — a swipe from the edge that opens a sidebar, a long
press that opens a menu — hear nothing; the page neither scrolls by itself nor selects text, and
iOS shows no magnifier. The line under the page becomes the drawing bar: **pen** (its width
follows the pressure), **marker**, **eraser** (takes away the whole stroke it touches), four
colours for each, **draw with a finger** (a touch screen only), **undo**, **redo**, and **✓** to stop.
Esc stops too, Mod+Z undoes and Mod+Shift+Z redoes.

Who draws: a pen always; the mouse; a finger only when drawing with a finger is on — on by default
on a phone, off on a tablet. Otherwise a finger moves the pages (in the scroll, gliding on when let
go; with pages turned one at a time, a swipe turns them), and the mouse wheel scrolls. The first
touch of a pen turns drawing with a finger off, and while a pen is down no finger does anything, so
the hand resting on the screen draws nothing.

Every stroke is kept in the page's units, so it keeps its place at any zoom and in either layout,
and turns dark with the page. It is written to the vault a moment after drawing stops — one SVG per
page beside the book, and a callout per page in the book's highlights note with the picture in it
(see the vault reference for the format). The PDF is never written.

Not yet: selecting words by drawing over them, notes pinned to a point or an area of a page,
fixed-layout books, and a copy of the PDF with the ink written into it.

The layer styles PDF.js needs (`text_layer_builder.css`, `annotation_layer_builder.css`, Apache
2.0) are carried in `plugin/src/vendor/pdfjs-css/`.

## Other formats

- **Mobipocket and Kindle** (`.mobi`, `.azw`, `.azw3`): both the old MOBI format and Kindle's
  KF8. A book protected by DRM — its header says its text is encrypted — is refused with a line
  saying so.
- **FictionBook** (`.fb2`, `.fbz`): its sections are the book's parts, its notes open in the note
  dialog, its pictures show.
- **Comic book archives** (`.cbz`): the pictures in the archive, in the order their names sort as
  numbers (`page2` before `page10`), one page at a time, fitted to the tab.
- **Fixed-layout EPUBs** — picture books, comics, some textbooks, whose pages are laid out by the
  book — are shown page by page (two side by side where the book asks for spreads), fitted to the
  tab.

A book of fixed pages (a comic, a fixed-layout EPUB) zooms like a PDF — Mod and plus or minus, a
pinch, the tab's menu — and has no text settings: its **Aa** dialog says so. Highlights, links to
places, search and the agent tools work in every format that has text.

The engine builds the pages of these formats itself, and not every format sends them through the
hook the EPUB cleaning uses. So each of their pages is taken as the engine made it and cleaned the
same way before a frame may open it — see below. One more fix was needed in the engine: it
unescaped a Kindle book's title and author through an element of the app's own document, where a
crafted title could have loaded and run something; it now does so in an inert document (listed
in the vendored engine's README).

## What the reader will not do: run the book's code

An EPUB is a small website, and it may carry scripts. A page of a book is drawn in a frame that
shares the app's address, so a script that ran could reach the vault on any device, and the
computer itself on the desktop. **Nothing a book carries is ever run.** Three layers stand in the
way, and each is enough on its own where the platform allows it:

1. **The book is cleaned before it is drawn.** Every page and every SVG picture is read and
   rebuilt without scripts, frames, embedded objects, `base`, `meta http-equiv` (refreshes,
   policies of its own), XSLT, event-handler attributes (`onclick`, `onload`, …) and
   `javascript:` links. A script file in the book is never loaded. A resource whose type could
   act as a page and is not one the reader cleans is handed over as plain bytes nothing
   displays; a chapter in such a format shows a line saying it is not shown.
2. **Every page carries a Content Security Policy** as the first thing in its head: no scripts
   of any kind, no network requests, no frames, no forms. Pictures, fonts and styles come only
   from the book itself.
3. **The frame is sandboxed without scripts** on the desktop and on Android. On the iPhone and
   iPad this is not possible — WebKit does not deliver taps and keys into such a frame
   ([WebKit bug 218086](https://bugs.webkit.org/show_bug.cgi?id=218086)) — so there the first two
   layers carry it.

Every page is checked once more as it arrives in its frame. A page still holding a script, a
handler or a runnable link — which the cleaning should make impossible — is emptied and replaced
by a line saying it was not shown.

Links to the web open in the system browser. Links of any other kind leading out of the book
(`file:`, `data:`, `javascript:`, other apps' schemes) do nothing.

A removed element is replaced by a hidden one of the same kind rather than dropped, so positions
in the book (EPUB CFIs) stay the same as in the book's own file.

The rules and the reasons are in `plugin/src/reader/bookSafety.ts`. The tests that prove them are
`tests/unit/bookSafety.test.ts` and, in the running app, `tests/e2e/bookReader.e2e.test.ts` (see
[Testing](Testing.md)).

## The engine

Pages are drawn by [foliate-js](https://github.com/johnfactotum/foliate-js) (MIT), the engine of
the Foliate and Readest readers. Its author does not publish it to npm, so its source is carried in
`plugin/src/vendor/foliate-js/` at a pinned commit, with its licence. The README there names the
commit, the files taken, and every local change, each marked `ABELE PATCH` in the source.
Archives are unpacked with `fflate`, one entry at a time as the engine asks for it.

## Limits

- A book is read from the vault whole, and each chapter's pictures are unpacked when the chapter
  is shown. Measured on the desktop with a 184 MB book of sixteen large pictures: it opened in
  under 0.1 s, the app's memory grew by about 175 MB for the file and peaked about 100 MB above
  that while paging through. Books of a few megabytes cost next to nothing. How far a phone goes
  has not been measured; a book of that size may not open there.
- Books open in the main window; pop-out windows are not supported yet.
- Scrolling runs through one chapter at a time; the next chapter follows when the end is reached.
- Protected (DRM) books cannot be opened; the reader says so instead of showing scrambled text.
