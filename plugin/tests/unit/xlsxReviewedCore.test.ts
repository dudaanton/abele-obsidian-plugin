import { afterEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync, UnzipInflate } from 'fflate'
import { openXlsx } from '@/spreadsheet/package'
import { applyWorkbookEdit } from '@/spreadsheet/edit'
import { writeWorkbookChange } from '@/spreadsheet/vaultAdapter'
import { saveParts } from '@/ooxml/package'
import { sameBytes } from '@/ooxml/write'
import { ChangeTracker, type Recording } from '@/ai/rewind/ChangeTracker'
import { useVault } from '../helpers/testEnv'
import { sampleParts, sampleXlsx } from '../fixtures/xlsx/sampleXlsx'

function forgedSize(bytes: Uint8Array, name: string, size: number): Uint8Array {
  const out = bytes.slice()
  const view = new DataView(out.buffer)
  const decoder = new TextDecoder()
  for (let at = 0; at < out.length - 46; at++) {
    const sig = view.getUint32(at, true)
    if (sig === 0x04034b50) {
      const n = view.getUint16(at + 26, true)
      if (decoder.decode(out.subarray(at + 30, at + 30 + n)) === name)
        view.setUint32(at + 22, size, true)
    }
    if (sig === 0x02014b50) {
      const n = view.getUint16(at + 28, true)
      if (decoder.decode(out.subarray(at + 46, at + 46 + n)) === name)
        view.setUint32(at + 24, size, true)
    }
  }
  return out
}
afterEach(() => {
  ChangeTracker.get()?.uninstall()
  vi.restoreAllMocks()
})

describe('workbooks use the reviewed Office core', () => {
  it('rejects actual inflated opaque bytes that exceed forged lengths, in bounded inflater chunks', async () => {
    const parts = sampleParts()
    parts['custom/sample.bin'] = new Uint8Array(128 * 1024).fill(42)
    const original = forgedSize(zipSync(parts), 'custom/sample.bin', 1)
    const push = vi.spyOn(UnzipInflate.prototype, 'push')
    await expect(openXlsx(original)).rejects.toThrow(/size|large/i)
    expect(push.mock.calls.length).toBeGreaterThan(0)
    expect(Math.max(...push.mock.calls.map(([bytes]) => bytes.length))).toBeLessThanOrEqual(1024)
  })
  it('validates edited XML with expanded attribute namespaces before returning an archive', async () => {
    const book = await openXlsx(sampleXlsx())
    const invalid = strToU8(
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:a="urn:sample" xmlns:b="urn:sample" a:flag="one" b:flag="two"><sheetData/></worksheet>'
    )
    await expect(saveParts(book, new Map([['xl/worksheets/sheet1.xml', invalid]]))).rejects.toThrow(
      /Duplicate XML attribute/
    )
  })
  it('validates every sheet before either hand or agent publication', async () => {
    const app = useVault([])
    const original = sampleXlsx()
    const file = await app.vault.createBinary('sample.xlsx', original.buffer as ArrayBuffer)
    const parts = sampleParts()
    parts['xl/worksheets/sheet2.xml'] = strToU8(
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><unknown:row/></sheetData></worksheet>'
    )
    await expect(writeWorkbookChange(app, file, original, zipSync(parts))).rejects.toThrow(
      /namespace/
    )
    expect(app.stats.modify).toBe(0)
    expect(new Uint8Array(await app.vault.readBinary(file))).toEqual(original)
  })
  it('does no asynchronous preparation or payload copies between final read and write, then reads back', async () => {
    const app = useVault([])
    const original = sampleXlsx()
    const file = await app.vault.createBinary('sample.xlsx', original.buffer as ArrayBuffer)
    const updated = await applyWorkbookEdit(await openXlsx(original), {
      sheet: 'Sample',
      range: 'B2',
      values: [[25]],
    })
    const order: string[] = []
    let reads = 0
    const read = app.vault.readBinary.bind(app.vault)
    const write = app.vault.modifyBinary.bind(app.vault)
    vi.spyOn(app.vault, 'readBinary').mockImplementation(async (f) => {
      order.push('read')
      const bytes = await read(f)
      if (++reads === 1) queueMicrotask(() => order.push('after-final-read'))
      return bytes
    })
    vi.spyOn(app.vault, 'modifyBinary').mockImplementation(async (f, bytes) => {
      order.push('write')
      await write(f, bytes)
    })
    await writeWorkbookChange(app, file, original, updated, undefined, () =>
      order.push('final-eligibility')
    )
    expect(order).toEqual([
      'final-eligibility',
      'read',
      'after-final-read',
      'final-eligibility',
      'write',
      'read',
    ])
  })
  it('detects a competing read-back and retains the prepared original for rewind even after conflict', async () => {
    const app = useVault([])
    const original = sampleXlsx()
    const file = await app.vault.createBinary('sample.xlsx', original.buffer as ArrayBuffer)
    const updated = await applyWorkbookEdit(await openXlsx(original), {
      sheet: 'Sample',
      range: 'B2',
      values: [[25]],
    })
    const competing = await applyWorkbookEdit(await openXlsx(original), {
      sheet: 'Sample',
      range: 'B2',
      values: [[45]],
    })
    const write = app.vault.modifyBinary.bind(app.vault)
    vi.spyOn(app.vault, 'modifyBinary').mockImplementation(async (f, bytes) => {
      await write(f, bytes)
      await write(f, competing.buffer as ArrayBuffer)
    })
    const tracker = ChangeTracker.install(app)
    const record = vi.fn<Recording['record']>()
    const stop = tracker.open({ record })
    try {
      await expect(writeWorkbookChange(app, file, original, updated)).rejects.toThrow(
        /changed while saving.*reopen/i
      )
    } finally {
      stop()
    }
    expect(record).toHaveBeenCalledTimes(1)
    const [, changes, blobs] = record.mock.calls[0]
    expect(changes[0].before.t).toBe('binary')
    expect([...blobs.values()].some((bytes) => sameBytes(new Uint8Array(bytes), original))).toBe(
      true
    )
    expect(new Uint8Array(await app.vault.readBinary(file))).toEqual(competing)
  })
  it('prepares rewind before the final check and retains the original on success', async () => {
    const app = useVault([])
    const original = sampleXlsx()
    const file = await app.vault.createBinary('sample.xlsx', original.buffer as ArrayBuffer)
    const updated = await applyWorkbookEdit(await openXlsx(original), {
      sheet: 'Sample',
      range: 'B2',
      values: [[25]],
    })
    const tracker = ChangeTracker.install(app)
    const record = vi.fn<Recording['record']>()
    const stop = tracker.open({ record })
    const prepare = vi.spyOn(tracker, 'prepareBinaryWrite')
    const read = app.vault.readBinary.bind(app.vault)
    vi.spyOn(app.vault, 'readBinary').mockImplementation(async (f) => {
      expect(prepare).toHaveBeenCalledOnce()
      return read(f)
    })
    try {
      await writeWorkbookChange(app, file, original, updated)
    } finally {
      stop()
    }
    expect(record).toHaveBeenCalledOnce()
    expect(
      [...record.mock.calls[0][2].values()].some((bytes) =>
        sameBytes(new Uint8Array(bytes), original)
      )
    ).toBe(true)
  })
})
