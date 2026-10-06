import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TFile, type App } from 'obsidian'
import { canvasAssets } from '@/canvas/pictureAdapter'
import { EXPORT_LIMITS } from '@/canvas/core/export'
import { buildFakeVault } from '../helpers/fakeVault'

let app: App, file: TFile
const createImage = vi.fn()
const doc = { win: { createEl: createImage }, defaultView: window } as unknown as Document
const graph = {
  nodes: [
    {
      id: 'image',
      type: 'file' as const,
      file: 'sample-image.png',
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    },
  ],
  edges: [],
}
const png = (width: number, height: number) => {
  const bytes = new Uint8Array(24)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  bytes.set([73, 72, 68, 82], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes.buffer
}
const load = (data = graph, inScope = () => true, signal?: AbortSignal) =>
  canvasAssets(app, data, 'sample.canvas', inScope, doc, signal, true)
beforeEach(() => {
  createImage.mockClear()
  app = buildFakeVault([{ path: 'sample-image.png' }]) as unknown as App
  file = app.vault.getAbstractFileByPath('sample-image.png') as TFile
  Object.assign(app.vault, { readBinary: vi.fn(async () => png(100000, 100000)) })
})
describe('bounded whole-canvas asset loading', () => {
  it('never decodes a small compressed file advertising an enormous image', async () => {
    const assets = await load()
    expect(assets.images.size).toBe(0)
    expect(assets.warnings[0].message).toMatch(/decoded-memory/)
    expect(createImage).not.toHaveBeenCalled()
  })
  it('does not read an oversized encoded image or an out-of-scope asset', async () => {
    file.stat.size = EXPORT_LIMITS.assetBytes + 1
    const assets = await load()
    expect(assets.warnings[0].message).toMatch(/byte limit/)
    expect(app.vault.readBinary).not.toHaveBeenCalled()
    const scoped = await load(graph, () => false)
    expect(scoped.warnings[0].message).toMatch(/scope/)
    expect(app.vault.readBinary).not.toHaveBeenCalled()
  })
  it('aborts at an asynchronous asset read without loading or delivering a picture', async () => {
    const controller = new AbortController()
    vi.mocked(app.vault.readBinary).mockImplementationOnce(async () => {
      controller.abort()
      return png(20, 20)
    })
    await expect(load(graph, () => true, controller.signal)).rejects.toThrow()
    expect(createImage).not.toHaveBeenCalled()
  })
  it('reports missing attachments rather than fetching remote replacements', async () => {
    const assets = await load({ ...graph, nodes: [{ ...graph.nodes[0], file: 'missing.png' }] })
    expect(assets.warnings[0].code).toBe('missing-file')
    expect(app.vault.readBinary).not.toHaveBeenCalled()
  })
  it('bounds cumulative decoded assets and releases loaded images and blob URLs', async () => {
    const url = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sample')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const image = {
      naturalWidth: 4096,
      naturalHeight: 4096,
      onload: null as (() => void) | null,
      onerror: null,
      _src: '',
    }
    Object.defineProperty(image, 'src', {
      get: () => image._src,
      set: (value: string) => {
        image._src = value
        if (value) queueMicrotask(() => image.onload?.())
      },
    })
    createImage.mockReturnValue(image)
    vi.mocked(app.vault.readBinary).mockResolvedValue(png(4096, 4096))
    try {
      const assets = await load({
        ...graph,
        nodes: [graph.nodes[0], { ...graph.nodes[0], id: 'second' }],
      })
      expect(assets.images.size).toBe(1)
      expect(createImage).toHaveBeenCalledOnce()
      expect(assets.warnings[0].ids).toEqual(['second'])
      assets.release()
      expect(image._src).toBe('')
      expect(revoke).toHaveBeenCalledWith('blob:sample')
    } finally {
      url.mockRestore()
      revoke.mockRestore()
    }
  })
})
