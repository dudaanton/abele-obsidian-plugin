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
  long press, not a finger held and then moved, not a tap while words are selected or a bar is
  open (that tap only closes the bar), not a tap on a highlight, a picture or a table.
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
- **Progress.** The line under the page names the chapter and says how far into the book the
  page is. Its slider goes anywhere in the book; on a phone dragging it never opens Obsidian's
  side panel.
- **Where it was left** is kept for each book under its identifier, so renaming or moving the file
  keeps it. It is written a moment after the last page turn, and at once when the app is hidden
  or quits, in two copies one after the other, so a write cut short by the app being stopped never
  loses it. It reaches another device where the plugin's own folder is synced.
- **Pictures and tables.** A picture that stands alone on the page is centred. A table wider than
  its column scrolls sideways in place. A tap on a picture or a table opens it full screen:
  pinch, Mod with the wheel, the buttons or plus and minus zoom; a drag moves it; a double tap
  zooms in on a spot and back; the middle button or 0 fits it again; a swipe down (while it is
  fitted), Escape or the close button closes it. Small pictures among the words — icons,
  letters — are left alone. A table is shown in a frame that runs nothing, like every page.

## Highlights, links and search

**Selecting words** on the page — with the mouse, or a long press on a phone — brings up a bar
under the page:

- a colour highlights them (yellow, green, blue, pink, purple, orange);
- the speech bubble highlights them and opens a box for a comment;
- the link copies a link to the words;
- the quote writes the words, with a link to them, into the note last worked in.

A **tap on a highlight** brings up the same bar for it: another colour, the comment, a link, the
quote, the highlights note, or remove it. A tap beside the bar closes it.

**A selection can run over several pages**, as in Apple Books. Held at the left or right edge of
the page for a moment — with the mouse, or with a finger — the selection turns the page and goes
on growing on the next one, a page a second while it stays there. On an iPhone, whose selection
handles do not tell the page where the finger is, an end of the selection moved onto the last
word of the page (or the first, going back) and left there does the same. The selection is one
range of the chapter and is highlighted, linked and quoted as one. It stops at the end of its
chapter, and says so; in a PDF or a book of fixed pages each page is a document of its own, and a
selection stays on its page.

**Highlights live in a note beside the book**, `<book> highlights.md`, made with the first one:

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
  opens a new chat whose input holds a link to the words and the words quoted. Nothing is sent
  until the person writes their question.
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
- A bar under the page, while it reads, pauses and goes on, reads the last sentence again, skips to
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
| Theme colours | On: the book in the theme's text, link and background colours, dark mode included. Off: the book's own colours on a light page. |
| Voice | The voice reading aloud: the device's own for the book's language, or one chosen. |
| Speed | How fast it reads aloud, 0.75× to 2×. |

On a phone the text starts just under Obsidian's header and the line under the page sits above its
navigation bar.

## PDF

PDFs open in the same reader, drawn by the PDF.js that Obsidian itself ships (`loadPdfJs()`), so
nothing is added to the plugin for it and the same library is on the phone. By default a `.pdf`
still opens in Obsidian's own viewer; there are two ways to read one here:

- **Open in Abele reader** in a PDF's menu — in the file explorer, or the ⋯ menu of a PDF that is
  open in Obsidian's viewer.
- **Open PDF files in the Abele reader** in Settings → Abele → Books: every PDF opens here until it
  is turned off, which gives `.pdf` back to Obsidian's viewer. Obsidian lets one view own an
  extension and refuses a second claim, so this goes through its view registry (not part of the
  plugin API); if a future Obsidian changes it, the setting does nothing and the menu item still
  works.

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

**Zoom** — Mod and plus or minus, Ctrl with the mouse wheel or a trackpad pinch, or **Zoom in**,
**Zoom out** and **Zoom as set** in the tab's ⋯ menu — changes the size of the pages in that tab,
keeping the page being read; Mod+0 goes back to the **Page size** setting. A zoom chosen this way
is not saved.

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
