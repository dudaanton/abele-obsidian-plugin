import { expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { openRangedZip } from '@/reader/rangedZip'
import { MAX_CHUNK_BYTES } from '@abele/sync-sdk/core'
import { sourceFile } from '@/reader/sourceFile'
import { pdfSource } from '@/reader/pdfSource'
import { vi } from 'vitest'
import { openVaultBook } from '@/reader/vaultBook'
import { BoundedVaultIo } from '@/sync/boundedVaultIo'
import type { App, TFile } from 'obsidian'

it('opens an archive and inflates only the requested resource through bounded reads', async () => {
  const archive = zipSync({
    'sample.txt': new TextEncoder().encode('sample chapter'),
    'image.bin': new Uint8Array(3 * MAX_CHUNK_BYTES).fill(73),
  })
  let maximum = 0
  const zip = await openRangedZip({
    size: archive.length,
    read: async (at, length) => {
      maximum = Math.max(maximum, length)
      return archive.slice(at, at + length)
    },
    assertUnchanged: async () => {},
    close: async () => {},
  })
  expect(zip.entries.map((e) => e.filename)).toEqual(['sample.txt', 'image.bin'])
  expect(await zip.loadText('sample.txt')).toBe('sample chapter')
  const image = await zip.loadBytes('image.bin')
  expect(image?.length).toBe(3 * MAX_CHUNK_BYTES)
  expect(image?.every((byte) => byte === 73)).toBe(true)
  expect(maximum).toBeLessThanOrEqual(MAX_CHUNK_BYTES)
})

it('opens a virtual 200 MiB archive by reading only its directory and requested chapter', async () => {
  const archive = zipSync({ 'sample.txt': new TextEncoder().encode('sample chapter') })
  const padding = 200 * MAX_CHUNK_BYTES - archive.length
  const view = new DataView(archive.buffer)
  const end = archive.length - 22,
    central = view.getUint32(end + 16, true)
  view.setUint32(central + 42, padding, true)
  view.setUint32(end + 16, central + padding, true)
  let readBytes = 0
  const zip = await openRangedZip({
    size: padding + archive.length,
    read: async (at, length) => {
      expect(length).toBeLessThanOrEqual(MAX_CHUNK_BYTES)
      readBytes += length
      const result = new Uint8Array(length)
      const start = Math.max(at, padding)
      result.set(archive.subarray(start - padding, at + length - padding), start - at)
      return result
    },
    assertUnchanged: async () => {},
    close: async () => {},
  })
  expect(await zip.loadText('sample.txt')).toBe('sample chapter')
  expect(readBytes).toBeLessThan(70000)
})

it('rejects corrupt resource bytes instead of handing them to the reader', async () => {
  const archive = zipSync({
    'sample.txt': [new TextEncoder().encode('sample chapter'), { level: 0 }],
  })
  const zip = await openRangedZip({
    size: archive.length,
    read: async (at, length) => archive.slice(at, at + length),
    assertUnchanged: async () => {},
    close: async () => {},
  })
  archive[30 + 'sample.txt'.length] ^= 1
  await expect(zip.loadText('sample.txt')).rejects.toThrow('archive')
})

it('serves Kindle record slices and PDF ranges with bounded reads and releases failed sources', async () => {
  const read = vi.fn(async (_at: number, length: number) => new Uint8Array(length).fill(73))
  const close = vi.fn(async () => {})
  const source = { size: 200 * MAX_CHUNK_BYTES, read, close, assertUnchanged: async () => {} }
  expect(new Uint8Array(await sourceFile(source).slice(100, 108).arrayBuffer())).toEqual(
    new Uint8Array(8).fill(73)
  )
  const onDataRange = vi.fn()
  const lib = {
    PDFDataRangeTransport: class {
      onDataRange = onDataRange
    },
  }
  const { range } = pdfSource(source, lib)
  await range.requestDataRange(0, 2 * MAX_CHUNK_BYTES)
  expect(read.mock.calls.every(([, length]) => length <= MAX_CHUNK_BYTES)).toBe(true)
  expect(onDataRange).toHaveBeenCalledOnce()
  expect(onDataRange.mock.calls[0][1].length).toBe(2 * MAX_CHUNK_BYTES)
  read.mockRejectedValueOnce(new Error('source changed'))
  range.failed = vi.fn()
  await range.requestDataRange(0, 4)
  expect(range.failed).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledOnce()
})

it('opens a large EPUB through the real reader entry point and closes its source on destroy', async () => {
  const parse = DOMParser.prototype.parseFromString
  const parser = vi.spyOn(DOMParser.prototype, 'parseFromString').mockImplementation(function (
    this: DOMParser,
    text,
    type
  ) {
    const doc = parse.call(this, text, type),
      query = doc.querySelectorAll.bind(doc)
    Object.assign(doc, {
      lookupNamespaceURI: () => doc.documentElement.namespaceURI,
      lookupPrefix: () => null,
      querySelectorAll: (selector: string) =>
        query(selector === '[*|href]:not([href])' ? 'a[href]' : selector),
    })
    return doc
  })
  const archive = zipSync(
      Object.fromEntries(
        Object.entries({
          mimetype: 'application/epub+zip',
          'META-INF/container.xml':
            '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
          'package.opf':
            '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="sample"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="sample">sample</dc:identifier><dc:title>Sample book</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
          'chapter.xhtml':
            '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Sample</title></head><body><p>Sample chapter.</p></body></html>',
        }).map(([name, text]) => [name, new TextEncoder().encode(text)])
      )
    ),
    close = vi.fn(async () => {})
  const read = vi.fn(async (at: number, length: number) => archive.slice(at, at + length))
  // The entry point chooses by actual disk size, rather than a stale file-index size.
  const source = { size: archive.length, read, close, assertUnchanged: async () => {} }
  const open = vi.spyOn(BoundedVaultIo.prototype, 'openRead').mockResolvedValue(source)
  const whole = vi.fn(() => {
    throw new Error('whole file')
  })
  // A padded source has a sparse prefix; only directory offsets change.
  const padding = 200 * MAX_CHUNK_BYTES - archive.length,
    data = new DataView(archive.buffer)
  const end = archive.length - 22,
    directory = data.getUint32(end + 16, true)
  let at = directory
  while (at < end) {
    data.setUint32(at + 42, data.getUint32(at + 42, true) + padding, true)
    at +=
      46 +
      data.getUint16(at + 28, true) +
      data.getUint16(at + 30, true) +
      data.getUint16(at + 32, true)
  }
  data.setUint32(end + 16, directory + padding, true)
  source.size = 200 * MAX_CHUNK_BYTES
  read.mockImplementation(async (at, length) => {
    const result = new Uint8Array(length),
      start = Math.max(at, padding)
    result.set(archive.subarray(start - padding, at + length - padding), start - at)
    return result
  })
  try {
    const opened = await openVaultBook(
      { vault: { adapter: { readBinary: whole }, configDir: '.obsidian' } } as unknown as App,
      { path: 'sample.epub', name: 'sample.epub', extension: 'EPUB', stat: { size: 1 } } as TFile
    )
    expect(opened.book.sections.length).toBeGreaterThan(0)
    expect(whole).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    opened.destroy()
    expect(close).toHaveBeenCalledOnce()
  } finally {
    open.mockRestore()
    parser.mockRestore()
  }
})

it('retains ZIP64 directory and resource support without reading the container whole', async () => {
  const base = zipSync({ sample: [new Uint8Array([1, 2, 3]), { level: 0 }] })
  const original = new DataView(base.buffer),
    oldEnd = base.length - 22
  const central = original.getUint32(oldEnd + 16, true),
    centralSize = oldEnd - central
  const insert = central + 46 + original.getUint16(central + 28, true)
  const bytes = new Uint8Array(base.length + 12 + 76),
    data = new DataView(bytes.buffer)
  bytes.set(base.subarray(0, insert))
  data.setUint16(insert, 1, true)
  data.setUint16(insert + 2, 8, true)
  data.setBigUint64(insert + 4, 3n, true)
  bytes.set(base.subarray(insert, oldEnd), insert + 12)
  data.setUint16(central + 30, 12, true)
  data.setUint32(central + 24, 0xffffffff, true)
  const record = oldEnd + 12,
    locator = record + 56,
    end = locator + 20
  data.setUint32(record, 0x06064b50, true)
  data.setBigUint64(record + 4, 44n, true)
  data.setBigUint64(record + 24, 1n, true)
  data.setBigUint64(record + 32, 1n, true)
  data.setBigUint64(record + 40, BigInt(centralSize + 12), true)
  data.setBigUint64(record + 48, BigInt(central), true)
  data.setUint32(locator, 0x07064b50, true)
  data.setBigUint64(locator + 8, BigInt(record), true)
  data.setUint32(locator + 16, 1, true)
  bytes.set(base.subarray(oldEnd), end)
  data.setUint16(end + 10, 65535, true)
  data.setUint32(end + 12, 0xffffffff, true)
  data.setUint32(end + 16, 0xffffffff, true)
  const zip = await openRangedZip({
    size: bytes.length,
    read: async (at, length) => bytes.slice(at, at + length),
    assertUnchanged: async () => {},
    close: async () => {},
  })
  expect(await zip.loadBytes('sample')).toEqual(new Uint8Array([1, 2, 3]))
})

it('decodes text input across chunk boundaries without assembling a binary copy', async () => {
  const text = 'a'.repeat(MAX_CHUNK_BYTES - 1) + 'Ж tail'
  const data = new TextEncoder().encode(text)
  const read = vi.fn(async (at: number, length: number) => data.slice(at, at + length))
  const file = sourceFile({
    size: data.length,
    read,
    assertUnchanged: async () => {},
    close: async () => {},
  })
  expect(await file.readText()).toBe(text)
  expect(read).toHaveBeenCalledTimes(2)
  expect(read.mock.calls.every(([, length]) => length <= MAX_CHUNK_BYTES)).toBe(true)
})
