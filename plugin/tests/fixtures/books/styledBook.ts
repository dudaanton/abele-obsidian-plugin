/**
 * A book that styles itself through linked stylesheets, one importing another: indents, a table
 * aligned to the right, a drop cap, a rule that would set the text size over the reader's own
 * (`!important`), and rules reaching outside the book — a picture on the web, an import from the
 * web — that must never be fetched.
 */
import { strToU8, zipSync } from 'fflate'

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>'

export const STYLED_BOOK_ID = 'urn:uuid:abele-styled-test-book'
/** Where the book's rules reaching outside it point; nothing may ever ask for it. */
export const OUTSIDE = 'https://outside.invalid'

export function buildStyledEpub(): Uint8Array {
  const files: Record<string, string> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
    'OPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">${STYLED_BOOK_ID}</dc:identifier><dc:title>Styled</dc:title>
<dc:creator>Abele</dc:creator><dc:language>en</dc:language>
</metadata><manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="css/book.css" media-type="text/css"/>
<item id="more" href="css/more.css" media-type="text/css"/>
<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
</manifest><spine><itemref idref="c1"/></spine></package>`,
    'OPS/nav.xhtml': `${HEAD}
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body>
<nav epub:type="toc"><ol><li><a href="c1.xhtml">One</a></li></ol></nav></body></html>`,
    'OPS/css/book.css': `@import "more.css";
@import url("${OUTSIDE}/remote.css");
p.indent { text-indent: 3em; }
td.num { text-align: right; }
p.big { font-size: 40px !important; }
#remote { height: 20px; background-image: url('${OUTSIDE}/pixel.png'); }`,
    'OPS/css/more.css': `p.dropcap::first-letter { float: left; font-size: 3em; }
p.centre { text-align: center; }`,
    'OPS/c1.xhtml': `${HEAD}
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title>
<link rel="stylesheet" type="text/css" href="css/book.css"/></head>
<body>
<h1>One</h1>
<p class="indent" id="indent">An indented paragraph of the book, long enough to run over a line or two of the page.</p>
<p class="centre" id="centre">Centred.</p>
<p class="dropcap" id="dropcap">Dropped capital begins this paragraph.</p>
<p class="big" id="big">Text the book wants huge.</p>
<table><tr><td>Item</td><td class="num" id="num">1 000</td></tr></table>
<div id="remote"></div>
</body></html>`,
  }
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}
  for (const [path, text] of Object.entries(files))
    entries[path] = [strToU8(text), { level: path === 'mimetype' ? 0 : 6 }]
  return zipSync(entries)
}
