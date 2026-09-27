/**
 * What a font file says of itself — its family, weight and style — and the families a folder of
 * them makes.
 *
 * A TrueType or OpenType file (`.ttf`, `.otf`) and a WOFF file keep their names in the `name`
 * table and their weight and slant in `OS/2`; a variable font keeps the weights it spans in
 * `fvar`. Those are read. A WOFF2 file is compressed whole with Brotli, which nothing here can
 * undo, so it is named by its file name the way font files usually are: `Literata-BoldItalic`.
 *
 * Pure apart from the WOFF tables' decompression, so all of it is tested without a vault.
 */

export const FONT_EXTENSIONS = ['ttf', 'otf', 'woff', 'woff2']

/** One face of a family: what a font file says it is. */
export interface FaceInfo {
  family: string
  /** A weight, or the range a variable font spans: `400`, `100 900`. */
  weight: string
  style: 'normal' | 'italic'
}

/** A font file in the fonts folder, with what it is. */
export interface FontFile extends FaceInfo {
  path: string
}

/** A family, as the reader's font list offers it: its files, one per weight and style. */
export interface FontFamily {
  name: string
  files: FontFile[]
}

/**
 * A family's name as it may stand in a stylesheet and in the settings: no quotes, braces or
 * other characters that would end a CSS string or rule, spaces collapsed.
 */
export function cleanFamily(name: string): string {
  return name
    .replace(/[\p{Cc}"'\\<>{};]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

// ---- file names ------------------------------------------------------------------------------

const WEIGHT_WORDS: [RegExp, number][] = [
  [/^(thin|hairline)/, 100],
  [/^(extra|ultra)light/, 200],
  [/^light/, 300],
  [/^(regular|normal|book|roman|plain)/, 400],
  [/^medium/, 500],
  [/^(semi|demi)bold/, 600],
  [/^(extra|ultra)bold/, 800],
  [/^bold/, 700],
  [/^(black|heavy)/, 900],
]

/** A run of style words, `bolditalic` or `extralight`, read; null when it is anything else. */
function styleWords(text: string): { weight: number | null; italic: boolean } | null {
  let rest = text.toLowerCase()
  let weight: number | null = null
  let italic = false
  if (!rest) return null
  while (rest) {
    const slant = /^(italic|oblique|it)/.exec(rest)
    if (slant) {
      italic = true
      rest = rest.slice(slant[0].length)
      continue
    }
    const hit = WEIGHT_WORDS.find(([re]) => re.test(rest))
    if (!hit) return null
    weight = hit[1]
    rest = rest.replace(hit[0], '')
  }
  return { weight, italic }
}

/** What a file's name says: `Literata-BoldItalic.woff2` is Literata, 700, italic. */
export function faceFromFileName(fileName: string): FaceInfo {
  let stem = fileName.replace(/^.*\//, '').replace(/\.[^.]+$/, '')
  let variable = false
  stem = stem
    .replace(/\[[^\]]*\]/g, () => {
      variable = true
      return ''
    })
    .replace(/[-_ ]?variable(font)?(_[\w,]+)?$/i, () => {
      variable = true
      return ''
    })
  const parts = stem.split(/[-_\s]+/).filter(Boolean)
  let family = parts.join(' ')
  let weight: number | null = null
  let italic = false
  // The fewest words from the start that leave a style after them.
  for (let i = 1; i < parts.length; i++) {
    const style = styleWords(parts.slice(i).join(''))
    if (!style) continue
    family = parts.slice(0, i).join(' ')
    weight = style.weight
    italic = style.italic
    break
  }
  return {
    family: cleanFamily(family) || cleanFamily(stem) || 'Font',
    weight: variable && weight === null ? '100 900' : String(weight ?? 400),
    style: italic ? 'italic' : 'normal',
  }
}

// ---- the tables ------------------------------------------------------------------------------

type Tables = Map<string, DataView>

const tagAt = (v: DataView, at: number) =>
  String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3))

/** Inflates a WOFF table (zlib); null where the platform has no way to. */
async function inflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

const WANTED = ['name', 'OS/2', 'fvar', 'head']

/** The tables that say what a font is, out of an sfnt or a WOFF file; null for anything else. */
async function tablesOf(buffer: ArrayBuffer): Promise<Tables | null> {
  const v = new DataView(buffer)
  if (v.byteLength < 12) return null
  const tables: Tables = new Map()
  const sig = v.getUint32(0)
  if (sig === 0x00010000 || tagAt(v, 0) === 'OTTO' || tagAt(v, 0) === 'true') {
    const n = v.getUint16(4)
    for (let i = 0; i < n; i++) {
      const at = 12 + i * 16
      if (at + 16 > v.byteLength) return null
      const tag = tagAt(v, at)
      const off = v.getUint32(at + 8)
      const len = v.getUint32(at + 12)
      if (WANTED.includes(tag) && off + len <= v.byteLength)
        tables.set(tag, new DataView(buffer, off, len))
    }
    return tables
  }
  if (tagAt(v, 0) === 'wOFF') {
    const n = v.getUint16(12)
    for (let i = 0; i < n; i++) {
      const at = 44 + i * 20
      if (at + 20 > v.byteLength) return null
      const tag = tagAt(v, at)
      const off = v.getUint32(at + 4)
      const comp = v.getUint32(at + 8)
      const orig = v.getUint32(at + 12)
      if (!WANTED.includes(tag) || off + comp > v.byteLength) continue
      const raw = new Uint8Array(buffer, off, comp)
      const data = comp < orig ? await inflate(raw) : raw
      if (!data) return null
      tables.set(tag, new DataView(data.buffer, data.byteOffset, data.byteLength))
    }
    return tables
  }
  return null
}

/** The name records by id, Windows Unicode first, then Mac Roman as Latin-1. */
function namesOf(name: DataView | undefined): Map<number, string> {
  const out = new Map<number, string>()
  if (!name || name.byteLength < 6) return out
  const count = name.getUint16(2)
  const base = name.getUint16(4)
  const found: { id: number; rank: number; text: string }[] = []
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12
    if (at + 12 > name.byteLength) break
    const platform = name.getUint16(at)
    const encoding = name.getUint16(at + 2)
    const language = name.getUint16(at + 4)
    const id = name.getUint16(at + 6)
    const len = name.getUint16(at + 8)
    const off = base + name.getUint16(at + 10)
    if (off + len > name.byteLength) continue
    let text = ''
    let rank: number
    if (platform === 3 || platform === 0) {
      if (platform === 3 && encoding !== 1 && encoding !== 10) continue
      for (let j = 0; j + 1 < len; j += 2) text += String.fromCharCode(name.getUint16(off + j))
      rank = platform === 3 && language === 0x409 ? 0 : 1
    } else if (platform === 1 && encoding === 0) {
      for (let j = 0; j < len; j++) text += String.fromCharCode(name.getUint8(off + j))
      rank = 2
    } else continue
    found.push({ id, rank, text })
  }
  found.sort((a, b) => a.rank - b.rank)
  for (const f of found) if (!out.has(f.id) && f.text.trim()) out.set(f.id, f.text.trim())
  return out
}

/** The span of a variable font's `wght` axis, as a weight range; null when it has none. */
function weightAxis(fvar: DataView | undefined): string | null {
  if (!fvar || fvar.byteLength < 16) return null
  const axesAt = fvar.getUint16(4)
  const count = fvar.getUint16(8)
  const size = fvar.getUint16(10)
  for (let i = 0; i < count; i++) {
    const at = axesAt + i * size
    if (at + 20 > fvar.byteLength) break
    if (tagAt(fvar, at) !== 'wght') continue
    const min = Math.round(fvar.getInt32(at + 4) / 0x10000)
    const max = Math.round(fvar.getInt32(at + 12) / 0x10000)
    return min === max ? String(min) : `${min} ${max}`
  }
  return null
}

/**
 * What a font file says it is; null when it is not a font this can read — a WOFF2 file among
 * them — and its name is all there is to go by.
 */
export async function faceFromFont(buffer: ArrayBuffer): Promise<FaceInfo | null> {
  let tables: Tables | null
  try {
    tables = await tablesOf(buffer)
  } catch {
    return null
  }
  if (!tables) return null
  const names = namesOf(tables.get('name'))
  const family = cleanFamily(names.get(16) ?? names.get(1) ?? '')
  if (!family) return null
  const os2 = tables.get('OS/2')
  const head = tables.get('head')
  let weight = os2 && os2.byteLength >= 6 ? os2.getUint16(4) : 0
  const selection = os2 && os2.byteLength >= 64 ? os2.getUint16(62) : 0
  const macStyle = head && head.byteLength >= 46 ? head.getUint16(44) : 0
  const sub = (names.get(17) ?? names.get(2) ?? '').replace(/\s+/g, '')
  const fromName = styleWords(sub)
  if (!weight || weight > 1000) weight = fromName?.weight ?? (macStyle & 1 ? 700 : 400)
  const italic = !!(selection & 0x201) || !!(macStyle & 2) || !!fromName?.italic
  return {
    family,
    weight: weightAxis(tables.get('fvar')) ?? String(weight),
    style: italic ? 'italic' : 'normal',
  }
}

/** Whether a path is a font file the reader takes. */
export function isFontPath(path: string): boolean {
  const ext = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? ''
  return FONT_EXTENSIONS.includes(ext)
}

/**
 * The families a folder's fonts make, by name, each with one file per weight and style — the
 * first by path where two say they are the same face.
 */
export function familiesOf(files: FontFile[]): FontFamily[] {
  const byName = new Map<string, FontFamily>()
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const key = file.family.toLowerCase()
    let family = byName.get(key)
    if (!family) byName.set(key, (family = { name: file.family, files: [] }))
    if (!family.files.some((f) => f.weight === file.weight && f.style === file.style))
      family.files.push(file)
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}
