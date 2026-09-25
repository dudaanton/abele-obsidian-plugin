/**
 * A book of plain prose in long paragraphs of different lengths, in Russian, with footnote marks
 * like `[26]` linking to a notes chapter — the shape of a nonfiction book, where paragraphs that
 * overlap on a page are easy to see and to measure.
 */
import { strToU8, zipSync } from 'fflate'

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>'

const WORDS = (
  'в порядке мысленного эксперимента вообразите бессмертный организм такой у которого нет ' +
  'конечного срока эксплуатации чтобы выжить он должен быть полностью приспособленным ко всем ' +
  'случайным событиям которые могут произойти в окружающей среде но у таких событий есть одно ' +
  'отвратительное свойство они как ни крути случайны природа меняет сама себя на каждом шагу'
).split(' ')

/** A paragraph of `n` words, the same for the same seed. */
function paragraph(seed: number, n: number): string {
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push(WORDS[(seed * 7 + i * 3) % WORDS.length])
  out[0] = out[0][0].toUpperCase() + out[0].slice(1)
  return out.join(' ')
}

let note = 0
const chapter = (n: number) => {
  const paras: string[] = []
  for (let i = 0; i < 120; i++) {
    const words = [140, 40, 90, 25, 160, 60][i % 6]
    let text = paragraph(n * 31 + i, words)
    if (i % 4 === 1) {
      note++
      text += `<a epub:type="noteref" href="notes.xhtml#n${note}" id="r${note}">[${note}]</a>`
    }
    if (i % 5 === 2) text = text.replace(' ', ' <i>будущим</i> ')
    paras.push(`<p id="p${n}-${i}">${text}.</p>`)
  }
  return `${HEAD}
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="ru">
<head><title>Глава ${n}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
<div class="section"><div class="title"><h2 id="c${n}">Глава ${n}</h2></div>
${paras.join('\n')}
</div>
</body></html>`
}

const STYLE = `p { text-indent: 0; margin: 0 0 1em 0; }
h2 { margin: 1em 0; }`

export const PROSE_BOOK_ID = 'urn:uuid:abele-prose-book'

export function buildProseEpub(): Uint8Array {
  note = 0
  const chapters = [1, 2, 3].map(chapter)
  const notes: string[] = []
  for (let i = 1; i <= note; i++)
    notes.push(`<p id="n${i}"><a href="c1.xhtml#r${i}">[${i}]</a> Примечание ${i}.</p>`)
  const files: Record<string, string> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
    'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">${PROSE_BOOK_ID}</dc:identifier><dc:title>Проза</dc:title>
<dc:creator>Abele</dc:creator><dc:language>ru</dc:language>
</metadata><manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="style.css" media-type="text/css"/>
<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
<item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
<item id="c3" href="c3.xhtml" media-type="application/xhtml+xml"/>
<item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/>
</manifest><spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/><itemref idref="notes"/></spine></package>`,
    'OEBPS/nav.xhtml': `${HEAD}
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Содержание</title></head><body>
<nav epub:type="toc"><ol>
<li><a href="c1.xhtml">Глава 1</a></li><li><a href="c2.xhtml">Глава 2</a></li>
<li><a href="c3.xhtml">Глава 3</a></li><li><a href="notes.xhtml">Примечания</a></li>
</ol></nav></body></html>`,
    'OEBPS/style.css': STYLE,
    'OEBPS/c1.xhtml': chapters[0],
    'OEBPS/c2.xhtml': chapters[1],
    'OEBPS/c3.xhtml': chapters[2],
    'OEBPS/notes.xhtml': `${HEAD}
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Примечания</title></head>
<body><h2>Примечания</h2>
${notes.join('\n')}
</body></html>`,
  }
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}
  for (const [path, text] of Object.entries(files))
    entries[path] = [strToU8(text), { level: path === 'mimetype' ? 0 : 6 }]
  return zipSync(entries)
}
