/**
 * Books in the other formats the reader opens, written byte by byte for the tests: a Mobipocket
 * book (the old MOBI format, text uncompressed), a FictionBook, a comic book archive — each
 * carrying the ways its format could smuggle code in, which must never run. The payloads are
 * the ones the EPUB tests use (`maliciousBook.ts`), so a run reports them the same way.
 */
import { strToU8, zipSync, zlibSync } from 'fflate'
import { payload } from './maliciousBook'

const attr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The page text every format carries, so the tests can find it. */
export const OTHER_TEXT = 'A page of the other-format test book.'

/** A MOBI (Mobipocket, version 6) book of two parts, split at a page break. */
export function buildMobi(opts: { encrypted?: boolean } = {}): Uint8Array {
  const html =
    `<html><head><guide></guide></head><body>` +
    `<h1>Part one</h1><p>${OTHER_TEXT}</p>` +
    `<script>${payload('mobi-script')}</script>` +
    `<p><img src="missing.png" onerror="${attr(payload('mobi-onerror'))}"/></p>` +
    `<p><a href="javascript:${attr(payload('mobi-link'))}" data-vector="mobi-link">a link</a></p>` +
    `<mbp:pagebreak/>` +
    `<h1>Part two</h1><p>The second part of the book.</p>` +
    `<iframe src="data:text/html,x"></iframe>` +
    `</body></html>`
  const text = strToU8(html)
  // Record 0: the PalmDOC header, then the MOBI header, then the title.
  const title = strToU8('Other format test')
  const rec0 = new Uint8Array(248 + title.length + 4)
  const v = new DataView(rec0.buffer)
  v.setUint16(0, 1) // no compression
  v.setUint32(4, text.length)
  v.setUint16(8, 1) // one text record
  v.setUint16(10, 4096)
  v.setUint16(12, opts.encrypted ? 2 : 0)
  rec0.set(strToU8('MOBI'), 16)
  v.setUint32(20, 232) // header length
  v.setUint32(24, 2) // a book
  v.setUint32(28, 65001) // UTF-8
  v.setUint32(32, 0x1234)
  v.setUint32(36, 6) // version 6: the old MOBI, not Kindle's KF8
  v.setUint32(84, 248) // title offset
  v.setUint32(88, title.length)
  v.setUint32(108, 0xffffffff) // no pictures
  v.setUint32(112, 0)
  v.setUint32(128, 0) // no EXTH
  v.setUint32(240, 0) // no trailing entries
  v.setUint32(244, 0xffffffff) // no index
  rec0.set(title, 248)

  const records = [rec0, text]
  const headerLength = 78 + records.length * 8 + 2
  const out = new Uint8Array(headerLength + records.reduce((n, r) => n + r.length, 0))
  const d = new DataView(out.buffer)
  out.set(strToU8('Other_format_test'), 0)
  out.set(strToU8('BOOKMOBI'), 60)
  d.setUint16(76, records.length)
  let offset = headerLength
  records.forEach((r, i) => {
    d.setUint32(78 + i * 8, offset)
    d.setUint32(78 + i * 8 + 4, i * 2)
    out.set(r, offset)
    offset += r.length
  })
  return out
}

/** A FictionBook with a note, a picture and the links FB2 allows — pointed at code. */
export function buildFb2(): Uint8Array {
  const png = tinyPng(40, 30, [200, 80, 80])
  let b64 = ''
  for (const byte of png) b64 += String.fromCharCode(byte)
  return strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info><genre>prose</genre><author><first-name>Abele</first-name><last-name>Test</last-name></author>
<book-title>FB2 test book</book-title><lang>en</lang></title-info>
<document-info><id>abele-fb2-test</id></document-info></description>
<body>
<section><title><p>Chapter one</p></title>
<p>${OTHER_TEXT}<a l:href="#n1" type="note">1</a></p>
<p><a l:href="javascript:${attr(payload('fb2-link'))}">a link</a></p>
<image l:href="#pic"/>
</section>
<section><title><p>Chapter two</p></title><p>The second chapter.</p></section>
</body>
<body name="notes"><section id="n1"><title><p>1</p></title><p>The note.</p></section></body>
<binary id="pic" content-type="image/png">${btoa(b64)}</binary>
</FictionBook>`)
}

/** A comic: three pictures, numbered so they sort in reading order. */
export function buildCbz(): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'page10.png': tinyPng(60, 90, [80, 80, 200]),
    'page2.png': tinyPng(60, 90, [80, 200, 80]),
    'page1.png': tinyPng(60, 90, [200, 80, 80]),
    'notes.txt': strToU8('not a page'),
  }
  return zipSync(files)
}

/** A PNG of one colour, made here so the tests need no picture files. */
export function tinyPng(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const row = new Uint8Array(1 + width * 3)
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3)
  const raw = new Uint8Array(row.length * height)
  for (let y = 0; y < height; y++) raw.set(row, y * row.length)
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (bytes: Uint8Array) => {
    let c = 0xffffffff
    for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const v = new DataView(out.buffer)
    v.setUint32(0, data.length)
    out.set(strToU8(type), 4)
    out.set(data, 8)
    v.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)))
    return out
  }
  const ihdr = new Uint8Array(13)
  const h = new DataView(ihdr.buffer)
  h.setUint32(0, width)
  h.setUint32(4, height)
  ihdr.set([8, 2, 0, 0, 0], 8)
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
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
