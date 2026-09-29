/**
 * A book for words underlined wherever they stand (vocabulary rules): its first chapter has a few
 * words in several forms, spread over pages — one split across an `<em>`, one inside a link of
 * the book's own, one written without its macron — and its second is a long chapter made of a
 * thousand-odd made-up words, where rules for most of them underline almost every word. All the
 * text is made up; no book's.
 */
import { strToU8, zipSync } from 'fflate'

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>'

const FILLER = (
  'vakarā mēs gājām pa ceļu gar upi un runājām par visu ko redzējām tur bija koki ' +
  'putni un zāle kas auga gar krastu līdz pašai ūdens malai'
).split(' ')

/** A paragraph of `n` filler words, the same for the same seed. */
const filler = (seed: number, n: number): string =>
  Array.from({ length: n }, (_, i) => FILLER[(seed * 7 + i * 3) % FILLER.length]).join(' ')

/**
 * The first chapter's paragraphs: filler, and the words a rule is made for. `māja` in its forms
 * stands eight times as a whole word (once split across an `<em>`, once as the book's own link),
 * `maja` without the macron once, and `kaķis` three times.
 */
const ONE = [
  `<p>Māja ${filler(1, 40)}.</p>`,
  `<p>${filler(2, 50)} mājas ${filler(3, 10)}.</p>`,
  `<p>${filler(4, 30)} mā<em>ja</em> ${filler(5, 30)} kaķis.</p>`,
  `<p>${filler(6, 60)} maja ${filler(7, 20)}.</p>`,
  `<p id="linked">${filler(8, 20)} <a href="c2.xhtml" id="to-two">mājā</a> ${filler(9, 30)}.</p>`,
  ...Array.from({ length: 14 }, (_, i) => `<p>${filler(10 + i, 70)}.</p>`),
  `<p>${filler(30, 20)} MĀJAS ${filler(31, 20)} kaķis ${filler(32, 20)}.</p>`,
  ...Array.from({ length: 14 }, (_, i) => `<p>${filler(40 + i, 70)}.</p>`),
  `<p>${filler(60, 10)} māja un mājā, mājas. ${filler(61, 20)} kaķis.</p>`,
]

/** The whole words of `māja`'s forms in the first chapter, and of the other words. */
export const VOCAB_COUNTS = { maja: 8, kakis: 3 }

const SYLLABLES = ['ka', 'lo', 'mi', 'ra', 'tu', 'ne', 'vo', 'si', 'da', 'pe', 'gu', 'zi']

/** 1200 made-up words, each different: what the long chapter is written in. */
export const MADE_UP: string[] = (() => {
  const out: string[] = []
  for (let a = 0; out.length < 1200; a++) {
    const word =
      SYLLABLES[a % 12] + SYLLABLES[Math.floor(a / 12) % 12] + SYLLABLES[Math.floor(a / 144) % 12]
    out.push(`${word}s`)
  }
  return out
})()

/** The long chapter: 120 paragraphs of 50 made-up words, the same every time. */
const TWO = (() => {
  let seed = 7
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648)
  return Array.from(
    { length: 120 },
    () => `<p>${Array.from({ length: 50 }, () => MADE_UP[next() % MADE_UP.length]).join(' ')}.</p>`
  )
})()

const chapter = (n: number, title: string, paras: string[]) => `${HEAD}
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="lv">
<head><title>${title}</title></head>
<body>
<h2 id="c${n}">${title}</h2>
${paras.join('\n')}
</body></html>`

export const VOCAB_BOOK_ID = 'urn:uuid:abele-vocab-book'

export function buildVocabEpub(): Uint8Array {
  const files: Record<string, string> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
    'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">${VOCAB_BOOK_ID}</dc:identifier><dc:title>Vārdu grāmata</dc:title>
<dc:creator>Abele</dc:creator><dc:language>lv</dc:language>
</metadata><manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
<item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
</manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
    'OEBPS/nav.xhtml': `${HEAD}
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Saturs</title></head><body>
<nav epub:type="toc"><ol>
<li><a href="c1.xhtml">Vārdi</a></li><li><a href="c2.xhtml">Daudz vārdu</a></li>
</ol></nav></body></html>`,
    'OEBPS/c1.xhtml': chapter(1, 'Vārdi', ONE),
    'OEBPS/c2.xhtml': chapter(2, 'Daudz vārdu', TWO),
  }
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}
  for (const [path, text] of Object.entries(files))
    entries[path] = [strToU8(text), { level: path === 'mimetype' ? 0 : 6 }]
  return zipSync(entries)
}
