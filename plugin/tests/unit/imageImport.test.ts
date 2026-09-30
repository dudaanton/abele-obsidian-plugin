import { expect, it, vi, beforeEach, afterEach } from 'vitest'
import { importExternalFile, isAllowedAttachment } from '@/ai/attachments'
import { useVault } from '../helpers/testEnv'
import { normalizeImageImport } from '@/media/imageImport'
import { pickImageFile } from '@/helpers/suggesters/ImagePicker'
import { FuzzySuggestModal, TFile } from 'obsidian'

const png = new Blob(['png'], { type: 'image/png' })
beforeEach(() => {
  // These guarantees use the platform decoder, not a bundled software decoder.
  vi.stubGlobal('Image', class {
    naturalWidth = 48
    naturalHeight = 32
    onload: (() => void) | null = null
    set src(_value: string) { queueMicrotask(() => this.onload?.()) }
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as any)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) => done(png))
  useVault([])
})

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('uses native HEIC decoding when available', async () => {
  const result = await normalizeImageImport('sample.heic', new Blob(['heic'], { type: 'image/heic' }))
  expect(result.blob).toBe(png)
})

it('accepts HEIC and HEIF attachments regardless of filename case', () => {
  expect(isAllowedAttachment('sample.HEIC')).toBe(true)
  expect(isAllowedAttachment('sample.heif')).toBe(true)
})
it('converts HEIC before storing it and checks collisions on the PNG name', async () => {
  const app = useVault([{ path: 'Attachments/sample.png', content: 'original' }])
  const made = await importExternalFile(new File(['heic'], 'sample.HEIC', { type: 'image/heic' }))
  expect(made.path).toBe('Attachments/sample 1.png')
  expect(app.vault.getAbstractFileByPath('Attachments/sample.HEIC')).toBeNull()
})
it('recognizes HEIC by MIME type even if the filename has no extension', async () => {
  const result = await normalizeImageImport('sample', new Blob(['heic'], { type: 'image/heic' }))
  expect(result.name).toBe('sample.png')
  expect(result.blob.type).toBe('image/png')
})
it('leaves ordinary files unchanged', async () => {
  const blob = new Blob(['png'], { type: 'image/png' })
  const result = await normalizeImageImport('sample.png', blob)
  expect(result).toEqual({ name: 'sample.png', blob })
})
it('converts existing HEIC picked from the vault for any image field, keeping the original', async () => {
  const app = useVault([{ path: 'Pictures/sample.heic', content: '' }])
  const opened = vi.spyOn(FuzzySuggestModal.prototype, 'open').mockImplementation(() => {})
  const picked = pickImageFile(app as never)
  const modal = opened.mock.contexts[0] as FuzzySuggestModal<TFile>
  modal.onChooseItem(app.vault.getAbstractFileByPath('Pictures/sample.heic') as TFile, new MouseEvent('click'))
  expect((await picked)?.path).toBe('Pictures/sample.png')
  expect(app.vault.getAbstractFileByPath('Pictures/sample.heic')).not.toBeNull()
})
