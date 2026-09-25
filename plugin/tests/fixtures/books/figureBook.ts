/**
 * A book with what a reader has to show large: a scanned table — a picture that is a page of the
 * book on its own, portrait-shaped, as the owner's book had — a small picture among the words
 * that must stay small, and an HTML table wider than any column.
 */
import { strToU8, zipSync, zlibSync } from 'fflate'

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>'

const CRC = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const u32 = (n: number) => new Uint8Array([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length)
  body.set(strToU8(type), 0)
  body.set(data, 4)
  const out = new Uint8Array(12 + data.length)
  out.set(u32(data.length), 0)
  out.set(body, 4)
  out.set(u32(crc32(body)), 8 + data.length)
  return out
}

/**
 * A grey-scale PNG of a ruled table: rows and columns of lines, darker cells here and there, so
 * that it looks like a table when pictured and its size can be measured.
 */
export function tablePng(width: number, height: number): Uint8Array {
  const raw = new Uint8Array((width + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0
    for (let x = 0; x < width; x++) {
      const line = y % 40 < 2 || x % 100 < 2 || x < 4 || y < 4 || x > width - 5 || y > height - 5
      const ink =
        !line && y % 40 > 14 && y % 40 < 26 && x % 100 > 14 && x % 100 < 30 + ((y * 7 + x) % 50)
      raw[y * (width + 1) + 1 + x] = line ? 40 : ink ? 90 : 250
    }
  }
  const ihdr = new Uint8Array([...u32(width), ...u32(height), 8, 0, 0, 0, 0])
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw)),
    chunk('IEND', new Uint8Array()),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const PARA = '<p>Plain text of the chapter, long enough to wrap onto several lines of a page.</p>'

const cells = (row: number) =>
  Array.from({ length: 14 }, (_, c) => `<td>R${row}C${c + 1} value</td>`).join('')

export const FIGURE_BOOK_ID = 'urn:uuid:abele-figure-test-book'

export function buildFigureEpub(): Uint8Array {
  const text: Record<string, string> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
    'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">${FIGURE_BOOK_ID}</dc:identifier><dc:title>Figure test book</dc:title>
<dc:language>en</dc:language>
</metadata><manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
<item id="scan" href="scan.png" media-type="image/png"/>
<item id="dot" href="dot.png" media-type="image/png"/>
</manifest><spine><itemref idref="c1"/></spine></package>`,
    'OEBPS/nav.xhtml': `${HEAD}
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body>
<nav epub:type="toc"><ol><li><a href="c1.xhtml">Tables</a></li></ol></nav></body></html>`,
    'OEBPS/c1.xhtml': `${HEAD}
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Tables</title>
<style>table { border-collapse: collapse; } td { border: 1px solid #888; padding: 2px 6px; white-space: nowrap; }</style>
</head><body>
<h1 id="start">Tables</h1>
<p id="inline">A small mark <img id="dot" src="dot.png" alt="dot"/> sits among the words.</p>
${PARA.repeat(3)}
<div class="plate"><img id="scan" src="scan.png" alt="Scanned table of rates"/></div>
${PARA.repeat(3)}
<table id="wide">${[1, 2, 3, 4].map((r) => `<tr>${cells(r)}</tr>`).join('')}</table>
${PARA.repeat(6)}
</body></html>`,
  }
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}
  for (const [path, value] of Object.entries(text))
    entries[path] = [strToU8(value), { level: path === 'mimetype' ? 0 : 6 }]
  entries['OEBPS/scan.png'] = [tablePng(700, 1000), { level: 6 }]
  entries['OEBPS/dot.png'] = [tablePng(16, 16), { level: 6 }]
  return zipSync(entries)
}
