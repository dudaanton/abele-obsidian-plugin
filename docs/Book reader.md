# Book reader

Abele opens EPUB books from the vault in a tab of their own. A `.epub` file opens in the reader
when it is clicked in the file explorer, on the desktop and on phones alike.

If another plugin already opens `.epub` files, Obsidian keeps that one, and Abele's reader stays
out of the way; the console says so.

## Reading

The book opens on its first chapter of text (the cover and front matter are skipped when the
book says where the text starts). Pages turn with the arrow keys, Page Up and Page Down, the
space bar, or a tap near the left or right edge of the page. The page takes the text colour and
link colour of the current Obsidian theme.

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
- Protected (DRM) books cannot be opened; the reader says so instead of showing scrambled text.
