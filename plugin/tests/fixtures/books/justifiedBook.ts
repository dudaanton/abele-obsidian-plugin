/**
 * A book of justified Russian prose in long paragraphs under section headings, the shape of a
 * translated nonfiction book: a heading, paragraphs indented and justified, a word in italics now
 * and then, each paragraph one sentence. The text is made up from a list of words; no book's.
 */
import { strToU8, zipSync } from 'fflate'

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>'

const WORDS = (
  'утром рыбак вышел к реке и долго смотрел на туман над водой потом он сел в лодку ' +
  'проверил сети и поплыл вдоль берега где росли старые ивы ветер был слабый и тёплый ' +
  'чайки кружили над отмелью а в деревне за холмом уже топили печи дети бежали к мосту ' +
  'чтобы увидеть как лодка возвращается с уловом к обеду небо прояснилось и река заблестела'
).split(' ')

/** A paragraph of `n` words, the same for the same seed. */
function paragraph(seed: number, n: number): string {
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push(WORDS[(seed * 11 + i * 3) % WORDS.length])
  out[0] = out[0][0].toUpperCase() + out[0].slice(1)
  return out.join(' ')
}

const chapter = (n: number) => {
  const parts: string[] = []
  for (let s = 0; s < 6; s++) {
    parts.push(`<h3 id="s${n}-${s}">Раздел ${n}.${s + 1}</h3>`)
    for (let i = 0; i < 6; i++) {
      let text = paragraph(n * 41 + s * 7 + i, [70, 35, 110, 50, 90, 25][i])
      if (i % 3 === 1) text = text.replace(' ', ' <i>внутри</i> ')
      parts.push(`<p id="p${n}-${s}-${i}">${text}.</p>`)
    }
  }
  return `${HEAD}
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="ru">
<head><title>Глава ${n}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
<h2 id="c${n}">Глава ${n}</h2>
${parts.join('\n')}
</body></html>`
}

export const JUSTIFIED_BOOK_ID = 'urn:uuid:abele-justified-book'

export function buildJustifiedEpub(): Uint8Array {
  const style = `body { font-family: serif; }
p { text-align: justify; text-indent: 1.2em; margin: 0; }
h2, h3 { margin: 1em 0 0.5em 1.5em; }`
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
<dc:identifier id="id">${JUSTIFIED_BOOK_ID}</dc:identifier><dc:title>Ровные строки</dc:title>
<dc:creator>Abele</dc:creator><dc:language>ru</dc:language>
</metadata><manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="style.css" media-type="text/css"/>
<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
<item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
</manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
    'OEBPS/nav.xhtml': `${HEAD}
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Содержание</title></head><body>
<nav epub:type="toc"><ol>
<li><a href="c1.xhtml">Глава 1</a></li><li><a href="c2.xhtml">Глава 2</a></li>
</ol></nav></body></html>`,
    'OEBPS/style.css': style,
    'OEBPS/c1.xhtml': chapters[0],
    'OEBPS/c2.xhtml': chapters[1],
  }
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}
  for (const [path, text] of Object.entries(files))
    entries[path] = [strToU8(text), { level: path === 'mimetype' ? 0 : 6 }]
  return zipSync(entries)
}
