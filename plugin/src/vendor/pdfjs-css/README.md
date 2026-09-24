# pdf.js viewer styles (vendored)

`text_layer_builder.css` and `annotation_layer_builder.css` from PDF.js 5.5.207
(https://github.com/mozilla/pdf.js, `web/`), as carried by foliate-js at commit
`78914aef4466eb960965702401634c2cb348e9b1` (`vendor/pdfjs/`). Unchanged.

Licence: Apache License 2.0, stated in the header of each file
(https://www.apache.org/licenses/LICENSE-2.0).

They position the invisible text layer over a rendered PDF page, so text can be selected and
found, and the link layer, so links can be followed. The PDF.js library itself is not carried
here: Abele uses the copy Obsidian ships (`loadPdfJs()`); see `docs/Book reader.md`.
