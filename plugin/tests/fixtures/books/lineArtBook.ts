/**
 * A book whose pictures are line art on transparency, as many diagrams are: a PNG with an alpha
 * channel, an SVG file shown by an `img`, and an SVG drawn in the page — all dark lines on no
 * background, made for white paper. In a dark theme they must still show.
 */
import { strToU8, zipSync } from 'fflate'
import { lineArtPng } from './figureBook'

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>'
const PARA = '<p>Plain text of the chapter, long enough to wrap onto several lines of a page.</p>'

const DRAWING = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 300 200">
<rect x="10" y="10" width="280" height="180" fill="none" stroke="#000" stroke-width="6"/>
<path d="M10 190 L290 10" stroke="#000" stroke-width="6"/></svg>`

export function buildLineArtEpub(): Uint8Array {
  const text: Record<string, string> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
    'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">urn:uuid:abele-line-art-test-book</dc:identifier><dc:title>Line art test book</dc:title>
<dc:language>en</dc:language>
</metadata><manifest>
<item id="nav" href="Text/nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="c1" href="Text/c1.xhtml" media-type="application/xhtml+xml"/>
<item id="art" href="Images/art.png" media-type="image/png"/>
<item id="drawing" href="Images/drawing.svg" media-type="image/svg+xml"/>
</manifest><spine><itemref idref="c1"/></spine></package>`,
    'OEBPS/Text/nav.xhtml': `${HEAD}
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body>
<nav epub:type="toc"><ol><li><a href="c1.xhtml">Diagrams</a></li></ol></nav></body></html>`,
    'OEBPS/Text/c1.xhtml': `${HEAD}
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Diagrams</title></head><body>
<h1>Diagrams</h1>
${PARA}
<div><img id="art" src="../Images/art.png" alt="A diagram"/></div>
<div><img id="drawing" src="../Images/drawing.svg" alt="A drawing"/></div>
<div>${DRAWING.replace('<svg ', '<svg id="inline" ')}</div>
${PARA.repeat(4)}
</body></html>`,
    'OEBPS/Images/drawing.svg': DRAWING,
  }
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}
  for (const [path, value] of Object.entries(text))
    entries[path] = [strToU8(value), { level: path === 'mimetype' ? 0 : 6 }]
  entries['OEBPS/Images/art.png'] = [lineArtPng(240, 100), { level: 6 }]
  return zipSync(entries)
}
