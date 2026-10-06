import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TFile, type App } from 'obsidian'
import { exportCanvas, exportPath } from '@/canvas/exportAdapter'
import { buildFakeVault } from '../helpers/fakeVault'

const mocks = vi.hoisted(() => ({ picture: vi.fn(), snapshot: vi.fn() }))
vi.mock('@/canvas/pictureAdapter', () => ({ canvasPicture: mocks.picture }))
vi.mock('@/canvas/obsidianStore', async (original) => ({
  ...(await original<typeof import('@/canvas/obsidianStore')>()),
  ObsidianCanvasStore: class {
    snapshot = mocks.snapshot
  },
}))
let app: App
let create: ReturnType<typeof vi.fn>
const source = {
  nodes: [
    { id: 'sample', type: 'text', text: 'Text — 日本語', x: 0, y: 0, width: 200, height: 100 },
  ],
  edges: [],
}
beforeEach(() => {
  app = buildFakeVault([{ path: 'sample.canvas', raw: JSON.stringify(source) }]) as unknown as App
  create = vi.fn(async (path: string) => app.vault.create(path, 'Sample encoded image'))
  Object.assign(app.vault, { createBinary: create })
  mocks.snapshot.mockResolvedValue({ graph: source, revision: 'sample-revision' })
  mocks.picture.mockResolvedValue({
    canvas: {
      width: 248,
      height: 148,
      toBlob: (fn: (blob: Blob) => void, mime: string) =>
        fn(new Blob(['sample image'], { type: mime })),
      toDataURL: () => 'data:image/png;base64,c2FtcGxl',
    },
    region: { x: -24, y: -24, width: 248, height: 148 },
    visible: ['sample'],
    warnings: [],
  })
})
const options = {
  path: 'sample.canvas',
  output: 'sample.png',
  format: 'png' as const,
  inScope: () => true,
}
describe('captured canvas export delivery', () => {
  it('uses the same detached snapshot and revision for human and agent delivery, without changing source', async () => {
    const before = await app.vault.read(app.vault.getAbstractFileByPath('sample.canvas') as TFile)
    const result = await exportCanvas(app, options)
    expect(result.revision).toBe('sample-revision')
    expect(result.visible).toEqual(['sample'])
    expect(mocks.picture.mock.calls[0][1]).not.toBe(source)
    expect(mocks.picture.mock.calls[0][3]).not.toHaveProperty('step')
    expect(create).toHaveBeenCalledOnce()
    expect(await app.vault.read(app.vault.getAbstractFileByPath('sample.canvas') as TFile)).toBe(
      before
    )
  })
  it('refuses existing outputs even if created while rendering, without overwriting', async () => {
    mocks.picture.mockImplementationOnce(async () => {
      await app.vault.create('sample.png', 'Existing bytes')
      return mocks.picture.getMockImplementation()!()
    })
    await expect(exportCanvas(app, options)).rejects.toThrow(/exists/)
    expect(create).not.toHaveBeenCalled()
  })
  it('cancels before delivery and surfaces encoding or write failures', async () => {
    const controller = new AbortController()
    mocks.picture.mockImplementationOnce(async () => {
      controller.abort()
      return {}
    })
    await expect(exportCanvas(app, { ...options, signal: controller.signal })).rejects.toThrow()
    expect(create).not.toHaveBeenCalled()
    mocks.picture.mockResolvedValueOnce({
      canvas: { toBlob: (fn: (blob: null) => void) => fn(null) },
    })
    await expect(exportCanvas(app, options)).rejects.toThrow(/encoding/)
    create.mockRejectedValueOnce(new Error('Sample write failure'))
    await expect(exportCanvas(app, options)).rejects.toThrow(/write failure/)
  })
  it('never reads a source outside scope and checks source authorization again before delivery', async () => {
    await expect(exportCanvas(app, { ...options, inScope: () => false })).rejects.toThrow(/scope/)
    expect(mocks.snapshot).not.toHaveBeenCalled()
    const inScope = vi.fn().mockReturnValueOnce(true).mockReturnValue(false)
    await expect(exportCanvas(app, { ...options, inScope })).rejects.toThrow(/scope/)
    expect(create).not.toHaveBeenCalled()
  })
  it('rejects traversal, hidden output directories and mismatched output extensions', () => {
    for (const path of [
      '../sample.png',
      '/sample.png',
      '.obsidian/sample.png',
      'a/../sample.png',
      'sample.pdf',
      'a\\sample.png',
    ])
      expect(() => exportPath(path, 'png')).toThrow()
    expect(exportPath('Sample attachments/sample.png', 'png')).toBe('Sample attachments/sample.png')
  })
  it('does not expose an incomplete final output when the binary write fails', async () => {
    create.mockImplementationOnce(async (path: string) => {
      await app.vault.create(path, 'Partial bytes')
      throw new Error('Sample interrupted write')
    })
    await expect(exportCanvas(app, options)).rejects.toThrow(/interrupted/)
    expect(app.vault.getAbstractFileByPath(options.output)).toBeNull()
    expect(app.vault.getFiles().map((file) => file.path)).toEqual(['sample.canvas'])
  })
  it('creates a self-contained raster-backed SVG without scripts or executable source text', async () => {
    await exportCanvas(app, { ...options, output: 'sample.svg', format: 'svg' })
    const bytes = create.mock.calls[0][1] as ArrayBuffer
    const text = new TextDecoder().decode(bytes)
    expect(text).toMatch(/^<svg/)
    expect(text).toContain('data:image/png;base64,')
    expect(text).not.toMatch(/<script|日本語/)
  })
})
