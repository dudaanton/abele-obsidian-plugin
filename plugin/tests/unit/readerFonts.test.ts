/**
 * The fonts folder, followed as its files change (`src/reader/readerFonts.ts`).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ReaderFonts, RESCAN_MS, type FontsVault } from '@/reader/readerFonts'
import { buildTinyFont } from '../helpers/tinyFont'

interface File {
  path: string
  name: string
  stat: { mtime: number; size: number }
  data: ArrayBuffer
}

function vault() {
  const files = new Map<string, File>()
  const handlers = new Map<string, ((...a: unknown[]) => void)[]>()
  let reads = 0
  const emit = (name: string, ...args: unknown[]) => handlers.get(name)?.forEach((h) => h(...args))
  const put = (path: string, data: Uint8Array | string, mtime = 1) => {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
    const existed = files.has(path)
    const file = {
      path,
      name: path.split('/').pop()!,
      stat: { mtime, size: bytes.length },
      data: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer,
    }
    files.set(path, file)
    emit(existed ? 'modify' : 'create', file)
  }
  /** A folder's entry, its children made from the files under it. */
  const folderAt = (path: string): object | null => {
    const under = [...files.values()].filter((f) => f.path.startsWith(`${path}/`))
    if (!under.length) return null
    const names = new Set(under.map((f) => f.path.slice(path.length + 1).split('/')[0]))
    return {
      path,
      name: path.split('/').pop(),
      children: [...names].map((n) => files.get(`${path}/${n}`) ?? folderAt(`${path}/${n}`)),
    }
  }
  const api: FontsVault = {
    getAbstractFileByPath: (path) => (files.get(path) ?? folderAt(path)) as never,
    readBinary: async (f) => {
      reads++
      return files.get(f.path)!.data
    },
    on: ((name: string, cb: (...a: unknown[]) => void) => {
      handlers.set(name, [...(handlers.get(name) ?? []), cb])
      return { name } as never
    }) as FontsVault['on'],
    offref: () => {},
  }
  return {
    api,
    put,
    remove(path: string) {
      const f = files.get(path)!
      files.delete(path)
      emit('delete', f)
    },
    rename(from: string, to: string) {
      const f = files.get(from)!
      files.delete(from)
      const moved = { ...f, path: to, name: to.split('/').pop()! }
      files.set(to, moved)
      emit('rename', moved, from)
    },
    reads: () => reads,
  }
}

const font = (family: string, weight = 400, italic = false) =>
  buildTinyFont({ family, weight, italic, subfamily: italic ? 'Italic' : 'Regular' })

afterEach(() => vi.useRealTimers())

describe('the fonts folder', () => {
  it('offers the families of the font files in it, and nothing outside it', async () => {
    const v = vault()
    v.put('Fonts/a.ttf', font('Literata'))
    v.put('Fonts/b.ttf', font('Literata', 700))
    v.put('Fonts/Sub/c.woff2', 'wOF2…')
    v.put('Fonts/notes.md', '# not a font')
    v.put('Elsewhere/d.ttf', font('Charis'))
    const fonts = new ReaderFonts(v.api, () => 'Fonts')
    await fonts.ensure()
    expect(fonts.families.value.map((f) => [f.name, f.files.length])).toEqual([
      ['c', 1],
      ['Literata', 2],
    ])
  })

  it('offers nothing when no folder is set', async () => {
    const v = vault()
    v.put('Fonts/a.ttf', font('Literata'))
    const fonts = new ReaderFonts(v.api, () => '')
    await fonts.ensure()
    expect(fonts.families.value).toEqual([])
  })

  it('follows files added, renamed, changed and removed, reading only what changed', async () => {
    vi.useFakeTimers()
    const v = vault()
    v.put('Fonts/a.ttf', font('Literata'))
    const fonts = new ReaderFonts(v.api, () => 'Fonts')
    const stop = fonts.start()
    await fonts.ensure()
    const settle = async () => {
      await vi.advanceTimersByTimeAsync(RESCAN_MS + 10)
      await fonts.ensure()
    }
    const version = fonts.version.value
    expect(v.reads()).toBe(1)

    v.put('Fonts/b.ttf', font('Charis'))
    await settle()
    expect(fonts.families.value.map((f) => f.name)).toEqual(['Charis', 'Literata'])
    expect(fonts.version.value).toBeGreaterThan(version)
    expect(v.reads()).toBe(2)

    v.rename('Fonts/b.ttf', 'Fonts/Charis.ttf')
    await settle()
    expect(fonts.families.value[0].files[0].path).toBe('Fonts/Charis.ttf')

    v.rename('Fonts/Charis.ttf', 'Archive/Charis.ttf')
    await settle()
    expect(fonts.families.value.map((f) => f.name)).toEqual(['Literata'])

    v.put('Fonts/a.ttf', font('Literata Next'), 2)
    await settle()
    expect(fonts.families.value.map((f) => f.name)).toEqual(['Literata Next'])

    v.remove('Fonts/a.ttf')
    await settle()
    expect(fonts.families.value).toEqual([])
    stop()
  })

  it('reads the folder again when the setting names another', async () => {
    vi.useFakeTimers()
    const v = vault()
    v.put('Fonts/a.ttf', font('Literata'))
    v.put('Books/b.ttf', font('Charis'))
    let folder = 'Fonts'
    const fonts = new ReaderFonts(v.api, () => folder)
    await fonts.ensure()
    folder = 'Books'
    fonts.folderChanged()
    await vi.advanceTimersByTimeAsync(10)
    await fonts.ensure()
    expect(fonts.families.value.map((f) => f.name)).toEqual(['Charis'])
  })

  it("gives a family's faces with their bytes, keeping only the family asked for", async () => {
    const v = vault()
    v.put('Fonts/a.ttf', font('Literata'))
    v.put('Fonts/b.ttf', font('Literata', 700, true))
    v.put('Fonts/c.ttf', font('Charis'))
    const fonts = new ReaderFonts(v.api, () => 'Fonts')
    const faces = await fonts.facesOf('literata')
    expect(faces.map((f) => [f.path, f.weight, f.style, f.data.byteLength > 100])).toEqual([
      ['Fonts/a.ttf', '400', 'normal', true],
      ['Fonts/b.ttf', '700', 'italic', true],
    ])
    const reads = v.reads()
    await fonts.facesOf('Literata')
    expect(v.reads()).toBe(reads)
    expect(await fonts.facesOf('Nothing')).toEqual([])
  })
})
