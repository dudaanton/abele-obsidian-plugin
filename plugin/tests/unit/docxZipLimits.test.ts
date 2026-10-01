import { describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync, unzipSync, UnzipInflate, Zip, ZipDeflate } from 'fflate'
import { openWordZip } from '@/word/boundedZip'
import { openDocx } from '@/word/package'
import { safeRenderBytes } from '@/word/renderSafety'
import { sampleDocx, sampleParts, paragraph } from '../fixtures/docx/sampleDocx'

/** Small invented DEFLATE payloads with inconsistent ZIP sizes, never a large binary fixture. */
function forgedSize(bytes: Uint8Array, name: string, size: number): Uint8Array {
  const out = bytes.slice()
  const view = new DataView(out.buffer)
  const encoded = new TextDecoder()
  for (let at = 0; at < out.length - 46; at++) {
    const signature = view.getUint32(at, true)
    if (signature === 0x04034b50) {
      const length = view.getUint16(at + 26, true)
      if (encoded.decode(out.subarray(at + 30, at + 30 + length)) === name)
        view.setUint32(at + 22, size, true)
    }
    if (signature === 0x02014b50) {
      const length = view.getUint16(at + 28, true)
      if (encoded.decode(out.subarray(at + 46, at + 46 + length)) === name)
        view.setUint32(at + 24, size, true)
    }
  }
  return out
}
function streamedZip(parts: Record<string, Uint8Array>): Uint8Array {
  const pieces: Uint8Array[] = []
  const writer = new Zip((error, bytes) => {
    if (error) throw error
    pieces.push(bytes)
  })
  for (const [name, bytes] of Object.entries(parts)) {
    const entry = new ZipDeflate(name)
    writer.add(entry)
    entry.push(bytes, true)
  }
  writer.end()
  const archive = new Uint8Array(pieces.reduce((n, bytes) => n + bytes.length, 0))
  let at = 0
  for (const piece of pieces) {
    archive.set(piece, at)
    at += piece.length
  }
  return archive
}
const limits = { compressed: 1_000_000, expanded: 8192, xml: 4096, entries: 100 }

describe('actual Word ZIP inflation limits', () => {
  it('rejects forged image sizes while feeding only bounded compressed chunks to the inflater', async () => {
    const parts = sampleParts(paragraph('Sample'))
    parts['word/media/sample.png'] = new Uint8Array(128 * 1024).fill(42)
    const archive = forgedSize(zipSync(parts), 'word/media/sample.png', 1)
    const push = vi.spyOn(UnzipInflate.prototype, 'push')
    try {
      await expect(openWordZip(archive, limits)).rejects.toThrow(/large|size/i)
      expect(push.mock.calls.length).toBeGreaterThan(0)
      expect(Math.max(...push.mock.calls.map(([bytes]) => bytes.length))).toBeLessThanOrEqual(1024)
    } finally {
      push.mockRestore()
    }
  })
  it('rejects forged XML sizes using the actual per-part budget', async () => {
    const parts = sampleParts(paragraph('Sample'))
    parts['word/custom.xml'] = strToU8('<sample>' + 'x'.repeat(16384) + '</sample>')
    const archive = forgedSize(zipSync(parts), 'word/custom.xml', 1)
    await expect(openWordZip(archive, { ...limits, expanded: 100_000 })).rejects.toThrow(
      /large|size/i
    )
  })
  it('loads all opaque parts under the aggregate budget rather than inflating only the body', async () => {
    const parts = sampleParts(paragraph('Sample'))
    parts['customXml/sample-data.bin'] = new Uint8Array(16384)
    await expect(openWordZip(zipSync(parts), limits)).rejects.toThrow(/large/)
  })
  it('supports streamed ZIP entries whose local headers omit the final lengths', async () => {
    const parts = sampleParts()
    const archive = streamedZip(parts)
    const doc = await openDocx(archive)
    expect(doc.paragraphs[0].text).toBe('Sample report')
    for (const [name, bytes] of Object.entries(parts))
      expect(doc.archive.loadBytes(name), name).toEqual(bytes)
  })

  it('keeps opaque part names intact when rebuilding the validated archive', async () => {
    const parts = Object.assign(Object.create(null), sampleParts())
    parts['__proto__'] = Uint8Array.from([1, 2, 3])
    const doc = await openDocx(streamedZip(parts))
    const rendered = await openWordZip(await safeRenderBytes(doc), { ...limits, expanded: 100_000 })
    expect(rendered.loadBytes('__proto__')).toEqual(Uint8Array.from([1, 2, 3]))
  })

  it('provides a disposable rebuilt archive to the preview library, never the original ZIP', async () => {
    const original = sampleDocx()
    const doc = await openDocx(original)
    const rendered = await safeRenderBytes(doc)
    expect(rendered === original).toBe(false)
    const parts = unzipSync(rendered)
    for (const entry of doc.archive.entries)
      expect(parts[entry.filename], entry.filename).toEqual(doc.archive.loadBytes(entry.filename))
  })
})
