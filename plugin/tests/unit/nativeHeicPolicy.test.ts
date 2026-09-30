import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { Notice, TFile } from 'obsidian'
import { normalizeImageImport } from '@/media/imageImport'
import { imageFileForImport } from '@/media/importImageFile'
import { importExternalFile, resolveAttachmentsForApi } from '@/ai/attachments'
import { useVault } from '../helpers/testEnv'

// A native decoder that cannot read HEIC, as on a desktop browser.
beforeEach(() => {
  vi.stubGlobal('Image', class {
    onerror: (() => void) | null = null
    set src(_value: string) { queueMicrotask(() => this.onerror?.()) }
  })
  Notice.shown.length = 0
  useVault([])
})
afterEach(() => vi.unstubAllGlobals())

it('preserves the incoming filename and bytes when native HEIC decoding is unavailable', async () => {
  const blob = new Blob(['fabricated undecodable data'], { type: 'image/heic' })
  const result = await normalizeImageImport('sample.heic', blob)
  expect(result.name).toBe('sample.heic')
  expect(result.blob).toBe(blob)
})
it('imports an unsupported HEIC as a file and explains where conversion is available', async () => {
  const app = useVault([])
  const made = await importExternalFile(new File(['sample'], 'sample.heic', { type: 'image/heic' }))
  expect(made.path).toBe('Attachments/sample.heic')
  expect(app.vault.getAbstractFileByPath('Attachments/sample.png')).toBeNull()
  expect(Notice.shown.at(-1)).toMatch(/HEIC.*iPhone\/iPad.*original file/i)
})
it('keeps an existing unsupported vault HEIC without creating a second copy', async () => {
  const app = useVault([{ path: 'Pictures/sample.heic', content: 'sample' }])
  const original = app.vault.getAbstractFileByPath('Pictures/sample.heic') as TFile
  expect(await imageFileForImport(app as never, original)).toBe(original)
  expect(app.vault.getFiles()).toHaveLength(1)
  expect(Notice.shown.at(-1)).toMatch(/HEIC.*iPhone\/iPad/i)
})
it.each(['sample', 'sample.jpg'])('retains HEIC type through storage and message resolution for MIME-only %s', async (name) => {
  const app = useVault([])
  const made = await importExternalFile(new File(['BINARY-SAMPLE-NOT-TEXT'], name, { type: 'image/heic' }))
  expect(await app.vault.readBinary(made)).toEqual(new TextEncoder().encode('BINARY-SAMPLE-NOT-TEXT').buffer)
  expect(made.path).toBe(`Attachments/${name}.heic`)
  const seen = vi.fn()
  const parts = await resolveAttachmentsForApi([made.path], seen)
  expect(parts).toEqual([{ type: 'text', text: `[File attachment: ${made.path} (HEIC/HEIF; not converted)]` }])
  expect(seen).not.toHaveBeenCalled()
  expect(JSON.stringify(parts)).not.toContain('BINARY-SAMPLE-NOT-TEXT')
})

it('labels a non-converted HEIC as a binary file, not model pixels or decoded text', async () => {
  useVault([{ path: 'Pictures/sample.heic', content: 'BINARY-SAMPLE-NOT-TEXT' }])
  const parts = await resolveAttachmentsForApi(['Pictures/sample.heic'])
  expect(parts).toEqual([{ type: 'text', text: '[File attachment: Pictures/sample.heic (HEIC/HEIF; not converted)]' }])
  expect(JSON.stringify(parts)).not.toContain('BINARY-SAMPLE-NOT-TEXT')
})
