/**
 * A tiny TrueType font, built in memory for the tests: no font file is kept in the repository.
 *
 * Every printable ASCII and Cyrillic letter is the same box, drawn `advance` units wide out of 1000, so text
 * set in it is plainly wider or narrower than in any other font and a test can tell at a glance
 * whether it arrived. It carries the tables a browser's font checker asks for (Chromium's OTS),
 * with the names and the weight and style a real font says of itself.
 */
import { deflateSync } from 'node:zlib'

export interface TinyFontOptions {
  /** The typographic family (name 16) and, unless `legacyFamily` is given, name 1 too. */
  family: string
  /** The style's name, as in name 17 and 2: `Regular`, `Bold Italic`. */
  subfamily?: string
  /** Name 1 when it differs from the family, as `Literata Light` beside `Literata`. */
  legacyFamily?: string
  weight?: number
  italic?: boolean
  /** How wide every letter is, out of 1000. */
  advance?: number
  /** A `wght` axis from…to, as a variable font says it. */
  weightAxis?: [number, number]
  /** Leave the typographic family (name 16) out, as older fonts do. */
  noTypographic?: boolean
}

/** The characters it has: printable ASCII, then Cyrillic. The first, space, is blank. */
const RANGES: [number, number][] = [
  [0x20, 0x7e],
  [0x400, 0x45f],
]
const FIRST = RANGES[0][0]
const LAST = RANGES[RANGES.length - 1][1]
const GLYPHS = RANGES.reduce((n, [a, b]) => n + b - a + 1, 0)

class Writer {
  bytes: number[] = []
  u8(n: number) {
    this.bytes.push(n & 0xff)
    return this
  }
  u16(n: number) {
    return this.u8(n >> 8).u8(n)
  }
  i16(n: number) {
    return this.u16(n < 0 ? n + 0x10000 : n)
  }
  u32(n: number) {
    return this.u16(Math.floor(n / 0x10000) & 0xffff).u16(n & 0xffff)
  }
  tag(t: string) {
    for (const c of t) this.u8(c.charCodeAt(0))
    return this
  }
  raw(b: ArrayLike<number>) {
    for (let i = 0; i < b.length; i++) this.bytes.push(b[i])
    return this
  }
  pad() {
    while (this.bytes.length % 4) this.bytes.push(0)
    return this
  }
}

const utf16 = (s: string): number[] => {
  const out: number[] = []
  for (const c of s) {
    const code = c.charCodeAt(0)
    out.push(code >> 8, code & 0xff)
  }
  return out
}

function nameTable(o: TinyFontOptions): number[] {
  const sub = o.subfamily ?? 'Regular'
  const records: [number, string][] = [
    [1, o.legacyFamily ?? o.family],
    [2, o.legacyFamily ? 'Regular' : sub],
    [3, `${o.family} ${sub}; tiny`],
    [4, `${o.family} ${sub}`],
    [6, `${o.family}-${sub}`.replace(/\s+/g, '')],
  ]
  if (!o.noTypographic) records.push([16, o.family], [17, sub])
  const w = new Writer()
  w.u16(0)
    .u16(records.length)
    .u16(6 + 12 * records.length)
  const strings: number[] = []
  for (const [id, text] of records) {
    const data = utf16(text)
    w.u16(3).u16(1).u16(0x409).u16(id).u16(data.length).u16(strings.length)
    strings.push(...data)
  }
  return w.raw(strings).bytes
}

/** The font's bytes. */
export function buildTinyFont(options: TinyFontOptions): Uint8Array {
  const o = { subfamily: 'Regular', weight: 400, italic: false, advance: 900, ...options }
  const count = GLYPHS + 1 // .notdef, then one glyph per character
  const adv = o.advance
  // glyf: nothing for .notdef and space, a box for every other letter.
  const box = new Writer()
  box
    .i16(1)
    .i16(50)
    .i16(0)
    .i16(adv - 50)
    .i16(700)
  box.u16(3).u16(0)
  for (let i = 0; i < 4; i++) box.u8(0x01)
  box
    .i16(50)
    .i16(0)
    .i16(adv - 100)
    .i16(0)
  box.i16(0).i16(700).i16(0).i16(-700)
  box.pad()
  const glyf = new Writer()
  const loca = new Writer()
  for (let g = 0; g < count; g++) {
    loca.u32(glyf.bytes.length)
    if (g >= 2) glyf.raw(box.bytes)
  }
  loca.u32(glyf.bytes.length)

  const head = new Writer()
  head.u32(0x00010000).u32(0x00010000).u32(0).u32(0x5f0f3cf5).u16(0x000b).u16(1000)
  head.u32(0).u32(0).u32(0).u32(0)
  head.i16(0).i16(0).i16(adv).i16(700)
  head.u16((o.weight >= 700 ? 1 : 0) | (o.italic ? 2 : 0))
  head.u16(8).i16(2).i16(1).i16(0)

  const hhea = new Writer()
  hhea
    .u32(0x00010000)
    .i16(800)
    .i16(-200)
    .i16(0)
    .u16(adv)
    .i16(0)
    .i16(50)
    .i16(adv - 50)
  hhea.i16(1).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).u16(count)

  const hmtx = new Writer()
  for (let g = 0; g < count; g++) hmtx.u16(g === 0 ? 500 : adv).i16(g >= 2 ? 50 : 0)

  const maxp = new Writer()
  maxp.u32(0x00010000).u16(count).u16(4).u16(1).u16(0).u16(0).u16(2)
  for (let i = 0; i < 8; i++) maxp.u16(0)

  // cmap: format 4, the characters in one run onto glyphs 1…, and the closing segment.
  let next = 1
  const segs = RANGES.map(([start, end]) => {
    const seg = { start, end, delta: next - start }
    next += end - start + 1
    return seg
  })
  segs.push({ start: 0xffff, end: 0xffff, delta: 1 })
  const segX2 = segs.length * 2
  const search = 2 * 2 ** Math.floor(Math.log2(segs.length))
  const sub4 = new Writer()
  sub4
    .u16(4)
    .u16(16 + segs.length * 8)
    .u16(0)
  sub4
    .u16(segX2)
    .u16(search)
    .u16(Math.log2(search / 2))
    .u16(segX2 - search)
  for (const s of segs) sub4.u16(s.end)
  sub4.u16(0)
  for (const s of segs) sub4.u16(s.start)
  for (const s of segs) sub4.i16(s.delta)
  for (let i = 0; i < segs.length; i++) sub4.u16(0)
  const cmap = new Writer()
  cmap.u16(0).u16(1).u16(3).u16(1).u32(12).raw(sub4.bytes)

  const os2 = new Writer()
  os2.u16(4).i16(adv).u16(o.weight).u16(5).u16(0)
  for (let i = 0; i < 10; i++) os2.i16(i < 4 ? 500 : 50)
  os2.i16(0)
  for (let i = 0; i < 10; i++) os2.u8(0)
  os2.u32(1).u32(0).u32(0).u32(0).tag('NONE')
  const bold = o.weight >= 700
  os2.u16((o.italic ? 0x01 : 0) | (bold ? 0x20 : 0) | (!o.italic && !bold ? 0x40 : 0))
  os2.u16(FIRST).u16(LAST).i16(800).i16(-200).i16(0).u16(800).u16(200)
  os2.u32(1).u32(0).i16(500).i16(700).u16(0).u16(0x20).u16(1)

  const post = new Writer()
  post
    .u32(0x00030000)
    .u32(o.italic ? 0xfff40000 : 0)
    .i16(-100)
    .i16(50)
    .u32(0)
  post.u32(0).u32(0).u32(0).u32(0)

  const tables: Record<string, number[]> = {
    'OS/2': os2.bytes,
    cmap: cmap.bytes,
    glyf: glyf.bytes,
    head: head.bytes,
    hhea: hhea.bytes,
    hmtx: hmtx.bytes,
    loca: loca.bytes,
    maxp: maxp.bytes,
    name: nameTable(o),
    post: post.bytes,
  }
  if (o.weightAxis) {
    const fvar = new Writer()
    fvar.u16(1).u16(0).u16(16).u16(2).u16(1).u16(20).u16(0).u16(8)
    fvar
      .tag('wght')
      .u32(o.weightAxis[0] * 0x10000)
      .u32(o.weight * 0x10000)
    fvar
      .u32(o.weightAxis[1] * 0x10000)
      .u16(0)
      .u16(2)
    tables.fvar = fvar.bytes
  }
  return sfnt(tables)
}

const checksum = (b: number[]): number => {
  let sum = 0
  for (let i = 0; i < b.length; i += 4)
    sum = (sum + ((b[i] << 24) | (b[i + 1] << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0))) >>> 0
  return sum
}

function sfnt(tables: Record<string, number[]>): Uint8Array {
  const tags = Object.keys(tables).sort()
  const n = tags.length
  const search = 16 * 2 ** Math.floor(Math.log2(n))
  const w = new Writer()
  w.u32(0x00010000)
    .u16(n)
    .u16(search)
    .u16(Math.log2(search / 16))
    .u16(n * 16 - search)
  let offset = 12 + 16 * n
  for (const t of tags) {
    w.tag(t).u32(checksum(tables[t])).u32(offset).u32(tables[t].length)
    offset += Math.ceil(tables[t].length / 4) * 4
  }
  for (const t of tags) w.raw(tables[t]).pad()
  return Uint8Array.from(w.bytes)
}

/** A host TrueType font under a test-only family, so the installed system face cannot mask a late load. */
export function aliasTrueTypeFont(font: Uint8Array, family: string): Uint8Array {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength)
  if (view.getUint32(0) !== 0x00010000) throw new Error('Supply a single TrueType font')
  const tables: Record<string, number[]> = {}
  for (let i = 0; i < view.getUint16(4); i++) {
    const at = 12 + i * 16
    const tag = String.fromCharCode(...font.subarray(at, at + 4))
    const offset = view.getUint32(at + 8),
      length = view.getUint32(at + 12)
    tables[tag] = Array.from(font.subarray(offset, offset + length))
  }
  tables.name = nameTable({ family })
  tables.head.fill(0, 8, 12)
  // The original signature no longer describes the renamed copy.
  delete tables.DSIG
  const result = sfnt(tables)
  const out = new DataView(result.buffer)
  for (let i = 0; i < out.getUint16(4); i++) {
    const at = 12 + i * 16
    if (out.getUint32(at) === 0x68656164)
      out.setUint32(out.getUint32(at + 8) + 8, (0xb1b0afba - checksum(Array.from(result))) >>> 0)
  }
  return result
}

/** The same font as a WOFF file, its tables compressed. */
export function toWoff(font: Uint8Array): Uint8Array {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength)
  const n = view.getUint16(4)
  const entries: { tag: number; sum: number; data: Uint8Array; orig: number }[] = []
  for (let i = 0; i < n; i++) {
    const at = 12 + i * 16
    const off = view.getUint32(at + 8)
    const len = view.getUint32(at + 12)
    const orig = font.subarray(off, off + len)
    const packed = deflateSync(orig)
    entries.push({
      tag: view.getUint32(at),
      sum: view.getUint32(at + 4),
      data: packed.length < orig.length ? packed : orig,
      orig: len,
    })
  }
  const w = new Writer()
  let offset = 44 + 20 * n
  const dir = new Writer()
  const body = new Writer()
  for (const e of entries) {
    dir.u32(e.tag).u32(offset).u32(e.data.length).u32(e.orig).u32(e.sum)
    body.raw(e.data).pad()
    offset += Math.ceil(e.data.length / 4) * 4
  }
  w.tag('wOFF').u32(0x00010000).u32(offset).u16(n).u16(0).u32(font.length)
  w.u16(1).u16(0).u32(0).u32(0).u32(0).u32(0).u32(0)
  w.raw(dir.bytes).raw(body.bytes)
  return Uint8Array.from(w.bytes)
}
