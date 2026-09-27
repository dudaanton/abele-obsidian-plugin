/**
 * Fonts from the vault put into a book's page (`src/reader/fontFaces.ts`).
 */
import { describe, it, expect } from 'vitest'
import { setDocumentFonts, type FaceData } from '@/reader/fontFaces'

class FakeFace {
  status = 'loading'
  loaded: Promise<FakeFace>
  constructor(
    readonly family: string,
    readonly source: ArrayBuffer,
    readonly descriptors: { weight?: string; style?: string }
  ) {
    const bad = new Uint8Array(source)[0] === 0xff
    this.loaded = bad
      ? Promise.reject(new Error('bad font')).finally(() => (this.status = 'error'))
      : Promise.resolve(this).finally(() => (this.status = 'loaded'))
    this.loaded.catch(() => {})
  }
}

function page() {
  const set = new Set<FakeFace>()
  const doc = {
    defaultView: { FontFace: FakeFace },
    fonts: { add: (f: FakeFace) => set.add(f), delete: (f: FakeFace) => set.delete(f) },
  }
  return { doc: doc as unknown as Document, set }
}

const face = (path: string, weight = '400', style: 'normal' | 'italic' = 'normal'): FaceData => ({
  path,
  weight,
  style,
  stamp: '1',
  data: new Uint8Array([0, 1, 0, 0]).buffer,
})

describe('fonts from the vault in a page', () => {
  it("puts a family's faces into the page under its name, and says when they are in", async () => {
    const { doc, set } = page()
    const done = await setDocumentFonts(doc, 'Literata', [
      face('Fonts/Literata-Regular.ttf'),
      face('Fonts/Literata-BoldItalic.ttf', '700', 'italic'),
    ])
    expect(done).toBe(true)
    expect([...set].map((f) => [f.family, f.descriptors.weight, f.descriptors.style])).toEqual([
      ['Literata', '400', 'normal'],
      ['Literata', '700', 'italic'],
    ])
    expect([...set].every((f) => f.status === 'loaded')).toBe(true)
  })

  it('does nothing when the page already has those very faces', async () => {
    const { doc, set } = page()
    await setDocumentFonts(doc, 'Literata', [face('a.ttf')])
    const before = [...set]
    expect(await setDocumentFonts(doc, 'Literata', [face('a.ttf')])).toBe(false)
    expect([...set]).toEqual(before)
  })

  it('takes out the faces it put in when the family changes, its files change, or none is wanted', async () => {
    const { doc, set } = page()
    await setDocumentFonts(doc, 'Literata', [face('a.ttf'), face('b.ttf', '700')])
    expect(await setDocumentFonts(doc, 'Literata', [face('a.ttf')])).toBe(true)
    expect(set.size).toBe(1)
    expect(await setDocumentFonts(doc, 'Charis', [face('c.ttf')])).toBe(true)
    expect([...set].map((f) => f.family)).toEqual(['Charis'])
    expect(await setDocumentFonts(doc, '', [])).toBe(true)
    expect(set.size).toBe(0)
    expect(await setDocumentFonts(doc, '', [])).toBe(false)
  })

  it('leaves out a file that is no font, and keeps the rest', async () => {
    const { doc, set } = page()
    const broken = { ...face('bad.ttf', '700'), data: new Uint8Array([0xff]).buffer }
    expect(await setDocumentFonts(doc, 'Literata', [face('a.ttf'), broken])).toBe(true)
    expect([...set].map((f) => f.descriptors.weight)).toEqual(['400'])
  })

  it('lets the later of two changes made at once win', async () => {
    const { doc, set } = page()
    const first = setDocumentFonts(doc, 'Literata', [face('a.ttf')])
    const second = setDocumentFonts(doc, 'Charis', [face('c.ttf')])
    expect(await first).toBe(false)
    expect(await second).toBe(true)
    expect([...set].map((f) => f.family)).toEqual(['Charis'])
  })

  it('does nothing in a page that has closed', async () => {
    const { doc } = page()
    ;(doc as unknown as { defaultView: null }).defaultView = null
    expect(await setDocumentFonts(doc, 'Literata', [face('a.ttf')])).toBe(false)
  })
})

describe('fonts still being read', () => {
  it('give way to a later change, however long they take', async () => {
    const { doc, set } = page()
    let release!: (f: FaceData[]) => void
    const slow = new Promise<FaceData[]>((r) => (release = r))
    const first = setDocumentFonts(doc, 'Literata', slow)
    const second = setDocumentFonts(doc, 'Charis', [face('c.ttf')])
    expect(await second).toBe(true)
    release([face('a.ttf')])
    expect(await first).toBe(false)
    expect([...set].map((f) => f.family)).toEqual(['Charis'])
  })
})
