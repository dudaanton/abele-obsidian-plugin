import { expect, it, vi, beforeEach, afterEach } from 'vitest'
import { importExternalFile, isAllowedAttachment } from '@/ai/attachments'
import { useVault } from '../helpers/testEnv'
import { normalizeImageImport } from '@/media/imageImport'
import { pickImageFile } from '@/helpers/suggesters/ImagePicker'
import { FuzzySuggestModal, TFile } from 'obsidian'

const decode = vi.hoisted(() => vi.fn())
vi.mock('@/media/heicDecoder', () => ({ decodeHeic: decode }))
beforeEach(() => {
  vi.stubGlobal('Image', class {
    onerror: (() => void) | null = null
    set src(_value: string) { queueMicrotask(() => this.onerror?.()) }
  })
  useVault([])
  decode.mockReset().mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
})

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('uses native HEIC decoding when available without loading the fallback', async () => {
  vi.stubGlobal('Image', class {
    naturalWidth = 48
    naturalHeight = 32
    onload: (() => void) | null = null
    set src(_value: string) { queueMicrotask(() => this.onload?.()) }
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as any)
  const png = new Blob(['png'], { type: 'image/png' })
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) => done(png))
  const result = await normalizeImageImport('sample.heic', new Blob(['heic'], { type: 'image/heic' }))
  expect(result.blob).toBe(png)
  expect(decode).not.toHaveBeenCalled()
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
  expect(decode).toHaveBeenCalledOnce()
})
it('recognizes HEIC by MIME type even if the filename has no extension', async () => {
  const result = await normalizeImageImport('sample', new Blob(['heic'], { type: 'image/heic' }))
  expect(result.name).toBe('sample.png')
  expect(result.blob.type).toBe('image/png')
})
it('leaves ordinary files unchanged without loading the decoder', async () => {
  const blob = new Blob(['png'], { type: 'image/png' })
  const result = await normalizeImageImport('sample.png', blob)
  expect(result).toEqual({ name: 'sample.png', blob })
  expect(decode).not.toHaveBeenCalled()
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

it('does not store an unreadable HEIC with a PNG extension', async () => {
  const app = useVault([])
  decode.mockRejectedValue(new Error('invalid image'))
  await expect(importExternalFile(new File(['bad'], 'sample.heic'))).rejects.toThrow('invalid image')
  expect(app.vault.getFiles()).toHaveLength(0)
})
