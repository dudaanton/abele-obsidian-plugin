import { beforeEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { buildScriptContext } from '@/scripting/ScriptContext'
import { useVault } from '../helpers/testEnv'

const zip = (files: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])))
let app: ReturnType<typeof useVault>
beforeEach(() => {
  app = useVault([])
})
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
