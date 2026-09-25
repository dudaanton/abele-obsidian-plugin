# foliate-js (vendored)

The e-book engine behind Abele's book reader.

- Upstream: https://github.com/johnfactotum/foliate-js
- Commit: `78914aef4466eb960965702401634c2cb348e9b1` (2026-05-01, "Use original hrefs for
  external links and add isExternal in fb2.js (#129)")
- Licence: MIT, `LICENSE` in this directory, copied from the same commit.

The author does not publish the library to npm and asks projects to carry the source; the
`foliate-js` package on npm is a republish by somebody else and is not used. The files here were
taken from the commit above as they are, and changed only where this README lists a patch.
Updating is a deliberate step: take a newer commit, re-apply the patches, update this file.

## Files taken

`view.js`, `epub.js`, `epubcfi.js`, `paginator.js`, `fixed-layout.js`, `progress.js`,
`overlayer.js`, `text-walker.js`, `search.js`, `footnotes.js`, `mobi.js`, `fb2.js`,
`comic-book.js`, `tts.js`.

Not taken: the demo reader (`reader.html`, `reader.js`, `ui/`), `opds.js`, `dict.js`,
`quote-image.js`, `uri-template.js`, the tests, the rollup setup and upstream's own `vendor/`
(zip.js, fflate and PDF.js). Archives are opened by Abele with the `fflate` package it already
depends on.

## Local changes

Every change is marked `ABELE PATCH` at its site.

1. **The frame sandbox is the host's to set** (`frame-options.js`, new; `paginator.js`,
   `fixed-layout.js`). Upstream hard-codes `allow-same-origin allow-scripts` on every page frame,
   because WebKit does not deliver events into a frame without `allow-scripts` (WebKit bug
   218086). Abele drops `allow-scripts` wherever the engine allows it — Chromium, which is the
   desktop app and Android — and keeps it only on the iPhone and iPad.
2. **Archives and PDF are opened by the host** (`view.js`, `makeBook`). The branches that
   imported upstream's vendored zip.js and PDF.js throw instead; the MOBI branch imports `fflate`
   from npm instead of upstream's vendored copy. Abele builds the book object itself and passes
   it to `open()`, so `makeBook` is only reached for formats that need neither.

3. **A book may name its fixed-layout renderer** (`view.js`, `open`). A book object carrying
   `fixedLayoutRenderer` gets that element instead of `foliate-fxl`: Abele's continuous scroll
   for PDFs (`src/reader/pdfScroll.ts`) is one.

4. **MOBI metadata is unescaped in an inert document** (`mobi.js`, `unescapeHTML`). Upstream set a
   book's own title, author and description as `innerHTML` of a `textarea` made in the app's
   document; a crafted value can end the textarea and leave an element that loads and runs there.
   Abele makes the textarea in a document from `DOMParser`, where nothing loads or runs.

5. **The engine's elements are named per load of the plugin** (`elements.js`, new; `view.js`,
   `paginator.js`, `fixed-layout.js`, `footnotes.js`). Upstream registers `foliate-view`,
   `foliate-paginator` and `foliate-fxl` once for the page. A name cannot be registered twice or
   taken back, so the plugin could not load again after being turned off and on, or updated,
   until the app restarted. Each load now registers `<name>-<six letters>` of its own, and
   creates its elements by those names.

6. **A finger that is selecting never moves the page** (`paginator.js`, the touch handlers).
   Upstream scrolled the page under every finger that moved and cancelled the move, which took a
   long press's small movements away from the platform's selection and turned the page under
   words being selected; and it turned the page by itself whenever a selection reached past the
   page while a pointer was down — a touch's pointer is cancelled, not lifted, once a long press
   selects, so that flag stayed set. Now a touch is a swipe only once it has moved past a small
   slop soon after it began, with nothing selected and nothing the host holds the page for
   (`holdPages`, a bar open); and the host turns pages under a selection held at the edge
   (`src/reader/selectionPaging.ts`).

## Additions

`view.d.ts`, `epub.d.ts` and `frame-options.d.ts` type the parts of the modules beside them that
Abele calls. They are Abele's, not upstream's.

## PDF

Upstream's `pdf.js` adapter is not carried as a file: Abele's `src/reader/pdfBook.ts` is adapted
from it (same MIT licence), using the PDF.js Obsidian ships instead of a vendored copy, and adding
the reader's page policy, audit and link rules. The two layer stylesheets are in
`src/vendor/pdfjs-css/`.

## What Abele adds around it

The engine itself does not make a book safe to show: its author says so, and asks for a Content
Security Policy. Abele's cleaning, policy and page audit are in `src/reader/bookSafety.ts`; the
reasons are in `docs/Book reader.md`.
