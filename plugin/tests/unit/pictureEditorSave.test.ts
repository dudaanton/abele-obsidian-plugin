import { afterEach, expect, it, vi } from 'vitest'
import { ImageInkView } from '@/drawing/ImageInkView'
import { wholePicture } from '@/drawing/crop'
import { confirmDialog } from '@/components/obsidian/dialogs'
import { useVault } from '../helpers/testEnv'
import type { TFile } from 'obsidian'
import { PictureHistory } from '@/drawing/pictureSession'

vi.mock('@/components/obsidian/dialogs', () => ({ confirmDialog: vi.fn() }))
afterEach(() => vi.restoreAllMocks())

it('updates the view header to the filename when a picture is opened', async () => {
  const titleEl = document.createElement('div')
  titleEl.textContent = 'Editing a picture'
  const host = {
    path: '',
    editor: { cropping: false },
    titleEl,
    loadPicture: vi.fn(async () => {}),
  }
  await ImageInkView.prototype.setState.call(
    host as never,
    { path: 'Pictures/sample.png' },
    {} as never
  )
  expect(titleEl.textContent).toBe('sample.png')
})

it('undoes and redoes crop and ink in their edit order', () => {
  const history = new PictureHistory()
  const original = wholePicture()
  history.reset(original, [])
  const cropped = { ...original, rect: { x: 0.1, y: 0, w: 0.8, h: 1 } }
  history.record(cropped, [])
  const ink = [
    {
      id: 'sample',
      type: 'text' as const,
      x: 1,
      y: 1,
      size: 12,
      text: 'Sample',
      color: 'black' as const,
    },
  ]
  history.record(cropped, ink)
  expect(history.undo()).toMatchObject({ crop: cropped, items: [] })
  expect(history.undo()).toMatchObject({ crop: original, items: [] })
  expect(history.redo()).toMatchObject({ crop: cropped, items: [] })
  expect(history.redo()).toMatchObject({ crop: cropped, items: ink })
})

it('asks before cancel and keeps the editor when discard is declined', async () => {
  const leaf = { detach: vi.fn() }
  const editor = { dirty: true, status: null }
  vi.mocked(confirmDialog).mockResolvedValue(false)
  expect(await ImageInkView.prototype.cancel.call({ leaf, editor } as never)).toBe(false)
  expect(leaf.detach).not.toHaveBeenCalled()
  vi.mocked(confirmDialog).mockResolvedValue(true)
  expect(await ImageInkView.prototype.cancel.call({ leaf, editor } as never)).toBe(true)
  expect(leaf.detach).toHaveBeenCalledOnce()
})

it('does not close or prompt while a save is running', async () => {
  const leaf = { detach: vi.fn() }
  vi.mocked(confirmDialog).mockClear()
  expect(
    await ImageInkView.prototype.cancel.call({
      leaf,
      editor: {
        dirty: true,
        status: { kind: 'saving', text: 'Saving…' },
      },
    } as never)
  ).toBe(false)
  expect(leaf.detach).not.toHaveBeenCalled()
  expect(confirmDialog).not.toHaveBeenCalled()
})

it('does not touch the source when rendering fails and retains edits with a visible error', async () => {
  const app = useVault([{ path: 'Pictures/sample.png', content: 'original bytes' }])
  const file = app.vault.getAbstractFileByPath('Pictures/sample.png') as TFile
  const modify = vi.spyOn(app.vault, 'modifyBinary')
  const editor = {
    dirty: true,
    crop: wholePicture(),
    width: 8000,
    height: 6000,
    status: null as unknown,
  }
  const host = {
    app,
    editor,
    contentEl: { win: window },
    picture: vi.fn(async () => {
      throw Error('sample encode failure')
    }),
  }
  const saving = (
    ImageInkView.prototype as unknown as {
      saving(this: unknown, action: () => Promise<unknown>): Promise<void>
    }
  ).saving
  await saving.call(host, () => ImageInkView.prototype.saveOver.call(host as never, file, true))
  expect(modify).not.toHaveBeenCalled()
  expect(await app.vault.read(file)).toBe('original bytes')
  expect(editor.dirty).toBe(true)
  expect(editor.status).toMatchObject({
    kind: 'error',
    text: expect.stringContaining('sample encode failure'),
  })
})

it('uses a free JPEG copy path for HEIC without modifying the source', async () => {
  const app = useVault([
    { path: 'Pictures/sample.heic', content: 'source' },
    { path: 'Pictures/sample drawn.jpg', content: 'existing' },
  ])
  const file = app.vault.getAbstractFileByPath('Pictures/sample.heic') as TFile
  const create = vi
    .spyOn(app.vault, 'createBinary')
    .mockResolvedValue({ path: 'Pictures/sample drawn 2.jpg' } as TFile)
  const host = { app, picture: vi.fn(async () => new Blob(['jpeg'])) }
  expect(await ImageInkView.prototype.saveOver.call(host as never, file, true)).toBe(false)
  await ImageInkView.prototype.saveNew.call(host as never, file, false)
  expect(create).toHaveBeenCalledWith('Pictures/sample drawn 2.jpg', expect.any(ArrayBuffer))
  expect(await app.vault.read(file)).toBe('source')
})

it('keeps newer edits dirty when an asynchronous save finishes', async () => {
  const editor = {
    dirty: true,
    crop: wholePicture(),
    width: 20,
    height: 10,
    status: null as unknown,
  }
  const host = { editor, contentEl: { win: window } }
  const saving = (
    ImageInkView.prototype as unknown as {
      saving(this: unknown, action: () => Promise<unknown>): Promise<void>
    }
  ).saving
  await saving.call(host, async () => {
    editor.crop.rect = { x: 0, y: 0, w: 0.5, h: 1 }
    return true
  })
  expect(editor.dirty).toBe(true)
})

it('keeps the decode error when saving a picture with no decoded pixels', async () => {
  const editor = {
    dirty: false,
    width: 0,
    height: 0,
    status: { kind: 'error', text: 'Cannot decode the picture' },
  }
  const host = { editor, contentEl: { win: window } }
  const action = vi.fn(async () => true)
  const saving = (
    ImageInkView.prototype as unknown as {
      saving(this: unknown, action: () => Promise<unknown>): Promise<void>
    }
  ).saving
  await saving.call(host, action)
  expect(action).not.toHaveBeenCalled()
  expect(editor.status).toMatchObject({ kind: 'error', text: 'Cannot decode the picture' })
})
