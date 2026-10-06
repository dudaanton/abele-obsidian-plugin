import { beforeEach, expect, it, vi } from 'vitest'
import { Menu, TFile, type App } from 'obsidian'
import { CanvasView } from '@/canvas/CanvasView'
import { buildFakeVault } from '../helpers/fakeVault'
import { deferred } from '../helpers/deferred'
const mocks = vi.hoisted(() => ({ export: vi.fn(), pick: vi.fn() }))
vi.mock('obsidian', async (original) => {
  const api = await original<typeof import('../mocks/obsidian')>()
  return {
    ...api,
    FileView: class extends api.FileView {
      async onUnloadFile() {}
    },
  }
})
vi.mock('@/canvas/exportAdapter', () => ({ exportCanvas: mocks.export }))
vi.mock('@/helpers/suggesters/VaultFilePicker', () => ({ pickAnyFile: mocks.pick }))
let view: CanvasView, app: App, file: TFile
beforeEach(() => {
  app = buildFakeVault([
    { path: 'sample.canvas', raw: '{"nodes":[],"edges":[]}' },
    { path: 'sample-note.md', raw: 'Original body' },
    { path: 'sample whole.png', raw: 'Sample picture' },
  ]) as unknown as App
  file = app.vault.getAbstractFileByPath('sample.canvas') as TFile
  Object.assign(app.fileManager, {
    getAvailablePathForAttachment: vi.fn(async () => 'sample whole.png'),
    generateMarkdownLink: vi.fn(() => '[[sample whole.png]]'),
  })
  view = Object.assign(Object.create(CanvasView.prototype), {
    app,
    file,
    closed: false,
    refreshToken: 0,
  })
  mocks.export.mockResolvedValue({
    file: app.vault.getAbstractFileByPath('sample whole.png'),
    warnings: [],
  })
})
it('offers explicit whole PNG/SVG/PDF while retaining current-view and step exports', () => {
  let titles: string[] = []
  const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent').mockImplementation(function () {
    titles = this.items.map((item) => item.title)
    return this
  })
  try {
    ;(view as unknown as { exportMenu(e: MouseEvent): void }).exportMenu(new MouseEvent('click'))
    expect(titles).toEqual(
      expect.arrayContaining([
        'Export whole canvas as PNG',
        'Export whole canvas as SVG',
        'Export whole canvas as PDF',
        'Export current view as PNG',
        'Export each step as SVG',
      ])
    )
  } finally {
    show.mockRestore()
  }
})
it('cancels an export on file unload before final delivery', async () => {
  const pending = deferred<never>()
  mocks.export.mockImplementationOnce(async (_app, options) => {
    await pending.promise
    options.signal.throwIfAborted()
  })
  const task = view.exportWhole('png')
  await Promise.resolve()
  await view.onUnloadFile(file)
  pending.resolve(undefined as never)
  await expect(task).resolves.toBeNull()
  expect(mocks.export.mock.calls[0][1].signal.aborted).toBe(true)
})
it('inserts a successfully exported attachment into a picked note without rewriting its existing body', async () => {
  await view.exportWhole('png')
  const note = app.vault.getAbstractFileByPath('sample-note.md') as TFile
  mocks.pick.mockResolvedValueOnce(note)
  await app.vault.modify(note, 'Original body  \n')
  await view.insertExport()
  expect(await app.vault.read(note)).toBe('Original body  \n\n![[sample whole.png]]\n')
})
