/**
 * A harmless book with what a reader has to handle: a nested table of contents, a footnote
 * marked the EPUB 3 way, one marked only by a superscript, a link to another chapter, and chapters
 * long enough to run over several pages.
 */
import { strToU8, zipSync } from 'fflate'

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>'
const PARA =
  '<p>Plain text of the chapter, long enough to wrap onto several lines of a page and fill it.</p>'

const chapter = (n: number, extra = '') => `${HEAD}
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Chapter ${n}</title></head>
<body>
<h1 id="c${n}">Chapter ${n}</h1>
${extra}
${PARA.repeat(30)}
<h2 id="c${n}-s2">Chapter ${n}, part two</h2>
${PARA.repeat(30)}
</body></html>`

const one = chapter(
  1,
  `<p id="with-note">A claim that needs a source.<a epub:type="noteref" href="#fn1" id="ref1">1</a>
  Another one, marked only as a superscript.<sup><a href="notes.xhtml#n2" id="ref2">2</a></sup>
  And <a href="c3.xhtml#c3" id="to-three">a link to chapter three</a>.</p>
  <aside epub:type="footnote" id="fn1"><p>The first note, from the same chapter.</p></aside>`
)

const notes = `${HEAD}
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Notes</title></head>
<body><h1>Notes</h1>
<p id="n2"><a href="c1.xhtml#ref2">2</a> The second note, at the end of the book.</p>
</body></html>`

const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

export const RICH_BOOK_ID = 'urn:uuid:abele-rich-test-book'

export function buildRichEpub(): Uint8Array {
  const files: Record<string, string> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': container,
    'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">${RICH_BOOK_ID}</dc:identifier><dc:title>Rich test book</dc:title>
<dc:creator>Abele</dc:creator><dc:language>en</dc:language>
</metadata><manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
<item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
<item id="c3" href="c3.xhtml" media-type="application/xhtml+xml"/>
<item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/>
</manifest><spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/><itemref idref="notes"/></spine></package>`,
    'OEBPS/nav.xhtml': `${HEAD}
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body>
<nav epub:type="toc"><ol>
<li><a href="c1.xhtml">Chapter 1</a><ol><li><a href="c1.xhtml#c1-s2">Chapter 1, part two</a></li></ol></li>
<li><a href="c2.xhtml">Chapter 2</a><ol><li><a href="c2.xhtml#c2-s2">Chapter 2, part two</a></li></ol></li>
<li><a href="c3.xhtml">Chapter 3</a></li>
<li><a href="notes.xhtml">Notes</a></li>
</ol></nav></body></html>`,
    'OEBPS/c1.xhtml': one,
    'OEBPS/c2.xhtml': chapter(2),
    'OEBPS/c3.xhtml': chapter(3),
    'OEBPS/notes.xhtml': notes,
  }
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}
  for (const [path, text] of Object.entries(files))
    entries[path] = [strToU8(text), { level: path === 'mimetype' ? 0 : 6 }]
  return zipSync(entries)
}

/**
 * A fixed-layout book, like a picture book or a comic laid out as pages: three pages of 600×800,
 * each with a line of text and a script that must not run.
 */
export function buildFixedEpub(): Uint8Array {
  const page = (n: number) => `${HEAD}
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Page ${n}</title>
<meta name="viewport" content="width=600, height=800"/>
<style>body { margin: 0; width: 600px; height: 800px; background: #fdf6e3; font: 32px serif; }</style>
</head><body><p id="line${n}">Fixed page ${n} of the picture book.</p>
<script>try{top.__abelePwned=(top.__abelePwned||[]).concat('fxl-${n}')}catch(e){}</script></body></html>`
  const files: Record<string, string> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': container,
    'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">urn:uuid:abele-fixed-test-book</dc:identifier><dc:title>Fixed test book</dc:title>
<dc:language>en</dc:language><meta property="rendition:layout">pre-paginated</meta>
</metadata><manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="p1" href="p1.xhtml" media-type="application/xhtml+xml"/>
<item id="p2" href="p2.xhtml" media-type="application/xhtml+xml"/>
<item id="p3" href="p3.xhtml" media-type="application/xhtml+xml"/>
</manifest><spine><itemref idref="p1"/><itemref idref="p2"/><itemref idref="p3"/></spine></package>`,
    'OEBPS/nav.xhtml': `${HEAD}
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body>
<nav epub:type="toc"><ol><li><a href="p1.xhtml">Page 1</a></li><li><a href="p3.xhtml">Page 3</a></li></ol></nav></body></html>`,
    'OEBPS/p1.xhtml': page(1),
    'OEBPS/p2.xhtml': page(2),
    'OEBPS/p3.xhtml': page(3),
  }
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}
  for (const [path, text] of Object.entries(files))
    entries[path] = [strToU8(text), { level: path === 'mimetype' ? 0 : 6 }]
  return zipSync(entries)
}
