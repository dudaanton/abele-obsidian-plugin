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
