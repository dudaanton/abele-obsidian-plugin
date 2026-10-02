import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import * as fflate from 'fflate'

vi.mock('fflate', async (original) => {
  const real = await original<typeof import('fflate')>()
  return { ...real, unzipSync: vi.fn(real.unzipSync) }
})
import { buildScriptContext } from '@/scripting/ScriptContext'
import { useVault } from '../helpers/testEnv'

const zip = (files: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])))
/** Central records deliberately share one STORE payload; no large fixture is allocated. */
function sharedStoredArchive(count: number, payloadSize: number, declaredSize: number): Uint8Array {
  const payload = new Uint8Array(payloadSize).fill(42)
  const base = zipSync({ 'sample-0000.bin': payload }, { level: 0 })
  const view = new DataView(base.buffer)
  const end = base.length - 22
  const central = view.getUint32(end + 16, true)
  const record = base.slice(central, end)
  const result = new Uint8Array(central + record.length * count + 22)
  result.set(base.subarray(0, central))
  for (let index = 0; index < count; index++) {
    const offset = central + index * record.length
    result.set(record, offset)
    result.set(strToU8(`sample-${String(index).padStart(4, '0')}.bin`), offset + 46)
    new DataView(result.buffer).setUint32(offset + 24, declaredSize, true)
  }
  const endOffset = central + record.length * count
  result.set(base.subarray(end), endOffset)
  const output = new DataView(result.buffer)
  output.setUint16(endOffset + 8, count, true)
  output.setUint16(endOffset + 10, count, true)
  output.setUint32(endOffset + 12, record.length * count, true)
  return result
}

let app: ReturnType<typeof useVault>
beforeEach(() => {
  app = useVault([])
})
afterEach(() => vi.restoreAllMocks())
const extract = async (bytes: Uint8Array, folder = 'Output') => {
  await app.vault.createBinary(
    'sample.zip',
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  )
  const ctx = buildScriptContext({ params: {}, logs: [], signal: new AbortController().signal })
  return ctx.unzip('sample.zip', folder)
}

describe('script archive extraction', () => {
  it.each([
    '../outside.md',
    'sub/../../outside.md',
    '/absolute.md',
    'C:/absolute.md',
    'sub\\..\\..\\outside.md',
    'bad\0name.md',
  ])('refuses %s before writing any archive entry', async (name) => {
    await expect(extract(zip({ 'valid.md': 'valid', [name]: 'bad' }))).rejects.toThrow()
    expect(app.vault.getAbstractFileByPath('Output/valid.md')).toBeNull()
  })
  it.each([
    '../Output',
    '/absolute',
    'C:/Output',
    'Output/../../outside',
    'Output\\..\\..\\outside',
  ])('refuses an invalid target %s', async (target) => {
    await expect(extract(zip({ 'valid.md': 'valid' }), target)).rejects.toThrow()
  })
  it('keeps ordinary nested and hidden files inside the chosen folder', async () => {
    expect(
      (
        await extract(zip({ 'valid.md': 'valid', 'sub/second.md': 'second', '.metadata': 'kept' }))
      ).sort()
    ).toEqual(['Output/.metadata', 'Output/sub/second.md', 'Output/valid.md'])
  })
  it('rejects excessive entry counts before creating anything', async () => {
    const files: Record<string, string> = {}
    for (let n = 0; n <= 5000; n++) files[`sample-${n}.txt`] = ''
    await expect(extract(zip(files))).rejects.toThrow(/entries/)
    expect(app.vault.getAbstractFileByPath('Output')).toBeNull()
  })
  it('checks declared uncompressed bytes before allocating the inflated file', async () => {
    const bytes = zip({ 'sample.txt': 'small' })
    const view = new DataView(bytes.buffer)
    for (let n = 0; n + 46 < bytes.length; n++) {
      if (view.getUint32(n, true) === 0x02014b50) {
        view.setUint32(n + 24, 512 * 1024 * 1024 + 1, true)
        break
      }
    }
    await expect(extract(bytes)).rejects.toThrow(/size|MB|bytes/)
    expect(app.vault.getAbstractFileByPath('Output')).toBeNull()
  })
  it('counts actual STORE bytes when the declared unpacked size is understated', async () => {
    const bytes = sharedStoredArchive(1, 32, 0)
    const paths = await extract(bytes)
    expect(paths).toEqual(['Output/sample-0000.bin'])
    const file = app.vault.getAbstractFileByPath(paths[0])!
    expect((await app.vault.readBinary(file as never)).byteLength).toBe(32)
  })
  it.each([0, 1])(
    'refuses shared STORE payloads declaring %s bytes before any payload allocation',
    async (declared) => {
      const bytes = sharedStoredArchive(513, 1024 * 1024, declared)
      const real = (await vi.importActual<typeof import('fflate')>('fflate')).unzipSync
      let admitted = 0
      vi.mocked(fflate.unzipSync).mockImplementation((data, options) =>
        real(data, {
          ...options,
          filter: (entry) => {
            const allowed = options?.filter?.(entry) ?? true
            if (allowed) {
              admitted++
              // Fail safely on the old implementation, before hundreds of MB are copied.
              throw new Error('Payload allocation admitted before checking the whole archive')
            }
            return false
          },
        })
      )
      await expect(extract(bytes)).rejects.toThrow(/Unpacked archive size/)
      expect(admitted).toBe(0)
      expect(app.vault.getAbstractFileByPath('Output')).toBeNull()
    }
  )
  it('checks compressed file size before reading the archive', async () => {
    const file = await app.vault.createBinary(
      'sample.zip',
      zip({ 'sample.txt': 'small' }).buffer as ArrayBuffer
    )
    file.stat.size = 64 * 1024 * 1024 + 1
    const read = vi.spyOn(app.vault, 'readBinary')
    const ctx = buildScriptContext({ params: {}, logs: [], signal: new AbortController().signal })
    await expect(ctx.unzip('sample.zip', 'Output')).rejects.toThrow(/size|MB|bytes/)
    expect(read).not.toHaveBeenCalled()
  })
})
