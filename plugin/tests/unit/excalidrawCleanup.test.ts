import { describe, expect, it, vi } from 'vitest'
import { TFile, type App } from 'obsidian'
import { ObsidianExcalidrawVault } from '@/canvas/excalidrawAdapter'

vi.mock('@/components/obsidian/dialogs', () => ({ openDialog: vi.fn() }))
vi.mock('@/components/ExcalidrawMigrationModal.vue', () => ({ default: {} }))
vi.mock('@/canvas/opening', () => ({ openCanvas: vi.fn() }))

describe('extracted picture ownership', () => {
  it('deletes the created file through the write facade', async () => {
    const file = { path: 'Sample picture.png' } as TFile
    const app = { vault: { getAbstractFileByPath: () => file } } as unknown as App
    const remove = vi.fn().mockResolvedValue(undefined)
    const writes = {
      vault: { createBinary: vi.fn().mockResolvedValue(file) },
      fileManager: { trashFile: remove },
    }
    const vault = new ObsidianExcalidrawVault(app, writes as unknown as App)
    const cleanup = await vault.createBinary(file.path, new ArrayBuffer(1))
    expect(remove).not.toHaveBeenCalled()
    await cleanup()
    expect(remove).toHaveBeenCalledExactlyOnceWith(file)
  })

  it('does not delete a replacement at the same path', async () => {
    const file = { path: 'Sample picture.png' } as TFile
    let current: TFile | null = file
    const remove = vi.fn().mockResolvedValue(undefined)
    const app = {
      vault: {
        getAbstractFileByPath: () => current,
        createBinary: vi.fn().mockResolvedValue(file),
      },
      fileManager: { trashFile: remove },
    } as unknown as App
    const cleanup = await new ObsidianExcalidrawVault(app).createBinary(
      file.path,
      new ArrayBuffer(1)
    )
    current = { path: file.path } as TFile
    await cleanup()
    expect(remove).not.toHaveBeenCalled()
    current = null
    await cleanup()
    expect(remove).not.toHaveBeenCalled()
  })
})

describe('migration reference adapter', () => {
  it('finds indexed backlinks and canvas nodes and edits the latest text through process', async () => {
    const makeFile = (path: string) =>
      Object.assign(new TFile(), { path, extension: path.split('.').pop() })
    const files = [
      'Sample.excalidraw.md',
      'Sample.canvas',
      'Reader.md',
      'Board.canvas',
      'Other.md',
    ].map(makeFile)
    const text: Record<string, string> = {
      'Reader.md': 'Latest edit ![[Sample.excalidraw|300]] [[Other]]',
      'Sample.excalidraw.md': '[[Sample.excalidraw]]',
      'Board.canvas': '{"nodes":[{"type":"file","file":"Sample.excalidraw.md"}]}',
      'Sample.canvas': '{"nodes":[]}',
    }
    const process = vi.fn(async (file: TFile, transform: (current: string) => string) => {
      text[file.path] = transform(text[file.path])
      return text[file.path]
    })
    const app = {
      vault: {
        getFiles: () => files,
        getAbstractFileByPath: (path: string) => files.find((f) => f.path === path),
      },
      metadataCache: {
        resolvedLinks: {
          'Reader.md': { 'Sample.excalidraw.md': 1 },
          'Sample.excalidraw.md': { 'Sample.excalidraw.md': 1 },
        },
        getFirstLinkpathDest: (link: string) => (link === 'Sample.excalidraw' ? files[0] : null),
      },
    } as unknown as App
    const result = await new ObsidianExcalidrawVault(app, {
      vault: { process },
    } as unknown as App).rewriteReferences('Sample.excalidraw.md', 'Sample.canvas')
    expect(result.rewritten).toBe(2)
    expect(result.files).toEqual([
      { path: 'Reader.md', count: 1 },
      { path: 'Board.canvas', count: 1 },
    ])
    expect(text['Reader.md']).toBe('Latest edit ![[Sample.canvas|300]] [[Other]]')
    expect(text['Sample.excalidraw.md']).toBe('[[Sample.excalidraw]]')
    expect(process.mock.calls.some(([file]) => file.path === 'Other.md')).toBe(false)
    expect(text['Board.canvas']).toContain('"file":"Sample.canvas"')
  })
})
