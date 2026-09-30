import { describe, it, expect } from 'vitest'
import {
  cleanFamily,
  faceFromFileName,
  faceFromFont,
  familiesOf,
  isFontPath,
  type FontFile,
} from '@/reader/fontNames'
import { aliasTrueTypeFont, buildTinyFont, toWoff } from '../helpers/tinyFont'

const buf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)

describe('a font file named by its name', () => {
  it.each([
    ['Literata-Regular.ttf', 'Literata', '400', 'normal'],
    ['Literata-BoldItalic.woff2', 'Literata', '700', 'italic'],
    ['Literata-Italic.otf', 'Literata', '400', 'italic'],
    ['PT Serif Bold.ttf', 'PT Serif', '700', 'normal'],
    ['Source_Serif_4-SemiBold.woff', 'Source Serif 4', '600', 'normal'],
    ['Inter Extra Light Italic.otf', 'Inter', '200', 'italic'],
    ['Merriweather-Black.ttf', 'Merriweather', '900', 'normal'],
    ['Fonts/Books/Charis.ttf', 'Charis', '400', 'normal'],
    ['Literata[opsz,wght].ttf', 'Literata', '100 900', 'normal'],
    ['Literata-Italic[opsz,wght].ttf', 'Literata', '100 900', 'italic'],
    ['Literata-VariableFont_opsz,wght.ttf', 'Literata', '100 900', 'normal'],
    ['Bold.ttf', 'Bold', '400', 'normal'],
  ])('%s is %s %s %s', (name, family, weight, style) => {
    expect(faceFromFileName(name)).toEqual({ family, weight, style })
  })
})

describe('a font file named by what it says of itself', () => {
  it('can alias a test font without changing its glyphs or metrics', async () => {
    const original = buildTinyFont({ family: 'Sample Original', advance: 750 })
    const aliased = aliasTrueTypeFont(original, 'Sample Alias')
    expect((await faceFromFont(buf(aliased)))?.family).toBe('Sample Alias')
    expect((await faceFromFont(buf(original)))?.family).toBe('Sample Original')
    const tables = (font: Uint8Array) => {
      const view = new DataView(font.buffer, font.byteOffset, font.byteLength)
      const out: Record<string, Uint8Array> = {}
      for (let i = 0; i < view.getUint16(4); i++) {
        const at = 12 + i * 16,
          offset = view.getUint32(at + 8)
        const tag = String.fromCharCode(...font.subarray(at, at + 4))
        if (tag !== 'name' && tag !== 'head')
          out[tag] = font.slice(offset, offset + view.getUint32(at + 12))
      }
      return out
    }
    expect(tables(aliased)).toEqual(tables(original))
  })

  it('reads the family, weight and slant of a TrueType font', async () => {
    const font = buildTinyFont({
      family: 'Abele Tiny',
      subfamily: 'Bold Italic',
      weight: 700,
      italic: true,
    })
    expect(await faceFromFont(buf(font))).toEqual({
      family: 'Abele Tiny',
      weight: '700',
      style: 'italic',
    })
  })

  it('takes the typographic family over the legacy one', async () => {
    const font = buildTinyFont({
      family: 'Abele Tiny',
      legacyFamily: 'Abele Tiny Light',
      subfamily: 'Light',
      weight: 300,
    })
    expect(await faceFromFont(buf(font))).toEqual({
      family: 'Abele Tiny',
      weight: '300',
      style: 'normal',
    })
  })

  it('falls back to the legacy family when there is no other', async () => {
    const font = buildTinyFont({ family: 'Old Face', noTypographic: true })
    expect((await faceFromFont(buf(font)))?.family).toBe('Old Face')
  })

  it('says the weights a variable font spans', async () => {
    const font = buildTinyFont({ family: 'Abele Var', weightAxis: [200, 800] })
    expect((await faceFromFont(buf(font)))?.weight).toBe('200 800')
  })

  it('reads a WOFF file, its tables compressed', async () => {
    const font = toWoff(buildTinyFont({ family: 'Abele Woff', weight: 500 }))
    expect(await faceFromFont(buf(font))).toEqual({
      family: 'Abele Woff',
      weight: '500',
      style: 'normal',
    })
  })

  it('says nothing of a file it cannot read', async () => {
    expect(await faceFromFont(new TextEncoder().encode('wOF2 not really').buffer)).toBeNull()
    expect(await faceFromFont(new ArrayBuffer(4))).toBeNull()
    expect(
      await faceFromFont(new TextEncoder().encode('hello there, not a font').buffer)
    ).toBeNull()
  })
})

describe('families', () => {
  const file = (path: string, family: string, weight = '400', style = 'normal'): FontFile => ({
    path,
    family,
    weight,
    style: style as 'normal' | 'italic',
  })

  it('groups faces by family, one file per weight and style, sorted by name', () => {
    const families = familiesOf([
      file('Fonts/b.ttf', 'Literata', '700'),
      file('Fonts/a.ttf', 'Literata'),
      file('Fonts/c.ttf', 'literata', '400', 'italic'),
      file('Fonts/a2.ttf', 'Literata'),
      file('Fonts/z.ttf', 'Charis'),
    ])
    expect(families.map((f) => f.name)).toEqual(['Charis', 'Literata'])
    expect(families[1].files.map((f) => f.path)).toEqual([
      'Fonts/a.ttf',
      'Fonts/b.ttf',
      'Fonts/c.ttf',
    ])
  })

  it('keeps only names a stylesheet can hold', () => {
    expect(cleanFamily(' Evil"; } body { x: "y ')).toBe('Evil body x: y')
  })

  it('knows a font file by its extension', () => {
    expect(isFontPath('Fonts/A.TTF')).toBe(true)
    expect(isFontPath('Fonts/a.woff2')).toBe(true)
    expect(isFontPath('Fonts/a.md')).toBe(false)
    expect(isFontPath('Fonts/ttf')).toBe(false)
  })
})
