/**
 * A book whose notes are written the way some converters write them: each note a `span` wrapped
 * around blocks — a `div` with the note's number, sometimes a paragraph holding only a small
 * superscript number, then the note's paragraph. An inline element around blocks; the words
 * inside it were measured where the blocks before them are. Its one chapter carries a picture, a
 * table drawn as an image inside a paragraph, as the same books do. All the text is made up.
 */
import { strToU8, zipSync } from 'fflate'
import { tablePng } from './figureBook'

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>'

const WORDS = (
  'оценка задача срок план час день работа результат проект команда время запас ' +
  'ошибка сравнение опыт метод решение список неделя вопрос ответ шаг'
).split(' ')

function sentence(seed: number, n: number): string {
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push(WORDS[(seed * 5 + i * 3) % WORDS.length])
  out[0] = out[0][0].toUpperCase() + out[0].slice(1)
  return out.join(' ') + '.'
}

export const NOTES_BOOK_ID = 'urn:uuid:abele-notes-test-book'
/** How many notes the notes part has. */
export const NOTE_COUNT = 40

export function buildNotesEpub(): Uint8Array {
  const paras: string[] = []
  for (let i = 0; i < 40; i++) {
    paras.push(
      `<p class="p1" id="c${i}">${sentence(i, [50, 20, 35][i % 3])}` +
        (i % 2 ? `<a href="notes.xhtml#n${i}" class="a">[${i}]</a>` : '') +
        '</p>'
    )
    if (i === 6)
      paras.push(
        '<p class="empty-line"/><p class="p1"><div class="image"><img class="z1" alt="" src="table.png"/></div></p><p class="empty-line"/>'
      )
  }
  const notes: string[] = []
  for (let n = 1; n <= NOTE_COUNT; n++)
    notes.push(
      `<span id="n${n}"><div class="title6">\n<p class="p">${n}</p>\n</div>` +
        (n % 3 === 0 ? `<p class="p1"><sup class="sup">${n + 50}</sup></p>` : '') +
        `<p class="p1" id="t${n}">${sentence(n + 7, [45, 12, 25, 70][n % 4])}</p></span>`
    )
  const files: Record<string, string | Uint8Array> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
    'OPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">${NOTES_BOOK_ID}</dc:identifier><dc:title>Примечания в спанах</dc:title>
<dc:creator>Abele</dc:creator><dc:language>ru</dc:language>
</metadata><manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="style.css" media-type="text/css"/>
<item id="png" href="table.png" media-type="image/png"/>
<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
<item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/>
</manifest><spine><itemref idref="c1"/><itemref idref="notes"/></spine></package>`,
    'OPS/nav.xhtml': `${HEAD}
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Содержание</title></head><body>
<nav epub:type="toc"><ol><li><a href="c1.xhtml">Глава</a></li><li><a href="notes.xhtml">Примечания</a></li></ol></nav></body></html>`,
    'OPS/style.css': `.title6 { font-size: 1.1em; font-weight: bold; margin: 1em 0 0.5em 2.5em; }
.p { margin: 0 0 0.5em 0; } .p1 { margin: 0; text-indent: 1.5em; }
.sup, .a { font-size: 0.7em; line-height: 0.1; } .empty-line { height: 1em; margin: 0; }`,
    'OPS/table.png': tablePng(600, 420),
    'OPS/c1.xhtml': `${HEAD}
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Глава</title><link rel="stylesheet" href="style.css" type="text/css"/></head>
<body class="z"><h2>Глава</h2>
${paras.join('\n')}
</body></html>`,
    'OPS/notes.xhtml': `${HEAD}
<html xmlns="http://www.w3.org/1999/xhtml"><head><title/><link rel="stylesheet" href="style.css" type="text/css"/></head>
<body class="z">
<div class="title"><p class="p">Примечания</p></div>
${notes.join('\n')}
</body></html>`,
  }
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}
  for (const [path, data] of Object.entries(files))
    entries[path] = [
      typeof data === 'string' ? strToU8(data) : data,
      { level: path === 'mimetype' ? 0 : 6 },
    ]
  return zipSync(entries)
}
