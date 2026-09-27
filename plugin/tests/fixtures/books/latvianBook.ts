/**
 * A short book of justified prose in a Latvian-like text — long words, macrons and cedillas,
 * short paragraphs — whose own stylesheet justifies every paragraph. Set in a monospace font,
 * the lines stretch their few spaces wide, which is where a word drawn in one place and selected
 * in another is easy to see and to measure. The text is made up from a list of words; no book's.
 */
import { strToU8, zipSync } from 'fflate'

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>'

const WORDS = (
  'šo grāmatu esmu veltījis pieaugušajam man jālūdz piedošana bērniem ka viņš dzīvo ' +
  'Francijā kur pašreiz valda bads un aukstums tādēļ viņam ļoti nepieciešams mierinājums ' +
  'visi šie aizbildinājumi tomēr nav pietiekami tad es veltīšu puisēnam kāds reiz bija ' +
  'mans draugs pieaugušie ir bijuši bērni tikai nedaudzi no viņiem to atceras'
).split(' ')

/** A paragraph of `n` words, the same for the same seed. */
function paragraph(seed: number, n: number): string {
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push(WORDS[(seed * 5 + i * 3) % WORDS.length])
  out[0] = out[0][0].toUpperCase() + out[0].slice(1)
  return out.join(' ')
}

const chapter = (n: number) => {
  const paras: string[] = []
  for (let i = 0; i < 40; i++)
    paras.push(`<p id="p${n}-${i}">${paragraph(n * 17 + i, [60, 25, 45, 12, 80][i % 5])}.</p>`)
  return `${HEAD}
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="lv">
<head><title>Nodaļa ${n}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
<h2 id="c${n}">Nodaļa ${n}</h2>
${paras.join('\n')}
</body></html>`
}

/** Justified, the way a book's own stylesheet often puts it, and set in a monospace font. */
const STYLE = `body { font-family: Menlo, Courier, monospace; }
p { text-align: justify; text-indent: 1.5em; margin: 0; }
h2 { text-align: center; margin: 1em 0; }`

export const LATVIAN_BOOK_ID = 'urn:uuid:abele-latvian-book'

export function buildLatvianEpub(): Uint8Array {
  const chapters = [1, 2].map(chapter)
  const files: Record<string, string> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
    'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">${LATVIAN_BOOK_ID}</dc:identifier><dc:title>Mazā grāmata</dc:title>
<dc:creator>Abele</dc:creator><dc:language>lv</dc:language>
</metadata><manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="style.css" media-type="text/css"/>
<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
<item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
</manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
    'OEBPS/nav.xhtml': `${HEAD}
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Saturs</title></head><body>
<nav epub:type="toc"><ol>
<li><a href="c1.xhtml">Nodaļa 1</a></li><li><a href="c2.xhtml">Nodaļa 2</a></li>
</ol></nav></body></html>`,
    'OEBPS/style.css': STYLE,
    'OEBPS/c1.xhtml': chapters[0],
    'OEBPS/c2.xhtml': chapters[1],
  }
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}
  for (const [path, text] of Object.entries(files))
    entries[path] = [strToU8(text), { level: path === 'mimetype' ? 0 : 6 }]
  return zipSync(entries)
}
