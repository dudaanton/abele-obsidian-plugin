import { afterEach, expect, it, vi } from 'vitest'
import type { DataAdapter } from 'obsidian'
import { mobilePaths, probeSequentialFiles } from '@/sync/mobileSequentialSource'
import { BoundedVaultIo } from '@/sync/boundedVaultIo'
afterEach(() => vi.unstubAllGlobals())
function setup(end: string | null = null) {
  const probe = new Map<string, Uint8Array>()
  const content = new Uint8Array(3 * 1024 * 1024 + 7).fill(73)
  const adapter = {
    getResourcePath: (path: string) => 'capacitor://localhost/_capacitor_file_/sample/' + path,
    exists: async (path: string) => probe.has(path),
    writeBinary: async (path: string, bytes: ArrayBuffer) => {
      probe.set(path, new Uint8Array(bytes))
    },
    remove: async (path: string) => {
      probe.delete(path)
    },
    stat: async () => ({ type: 'file', size: content.length, mtime: 1, ctime: 1 }),
    appendBinary: async () => {},
    readBinary: () => {
      throw new Error('whole-file read')
    },
  } as unknown as DataAdapter
  const calls: unknown[] = []
  const files = {
    stat: async ({ path }: { path: string }) => ({
      size: probe.get(path.slice('file:///sample/'.length))?.length ?? content.length,
    }),
    readFileInChunks: vi.fn(async (options, callback) => {
      calls.push(options)
      expect(options.offset).toBeUndefined()
      expect(options.length).toBeUndefined()
      const data = probe.get(options.path.slice('file:///sample/'.length)) ?? content
      // Native callbacks may outrun a consumer; a synchronous burst must remain bounded.
      for (let at = 0; at < data.length; at += options.chunkSize) {
        const part = data.subarray(at, at + options.chunkSize)
        let binary = ''
        for (const byte of part) binary += String.fromCharCode(byte)
        callback({ data: btoa(binary) })
      }
      callback({ data: end })
      return 'sample-callback'
    }),
  }
  return { adapter, files, content, calls, probe }
}
it.each([null, ''])(
  'reads sequential-only callbacks with EOF %s without whole-file buffering',
  async (end) => {
    const f = setup(end)
    const events: unknown[] = []
    const capability = await probeSequentialFiles(f.adapter, f.files, (event) => events.push(event))
    expect(capability).not.toBeNull()
    expect(f.probe.size).toBe(0)
    const source = capability!.open('sample.bin', f.content.length)
    for (let at = 0; at < f.content.length; at += 1024 * 1024) {
      const chunk = await source.read(at, Math.min(1024 * 1024, f.content.length - at))
      expect(chunk.buffer.byteLength).toBeLessThanOrEqual(1024 * 1024)
      expect(chunk[0]).toBe(73)
    }
    await source.close()
    expect(events).toEqual(
      expect.arrayContaining([expect.objectContaining({ step: 'chunk', bytes: 4096 })])
    )
  }
)
it('rejects callback errors and deletes the probe file', async () => {
  const f = setup()
  f.files.readFileInChunks.mockImplementation(async (_options, callback) => {
    callback(null, { message: 'sample failure' })
    return 'sample'
  })
  const events: unknown[] = []
  expect(await probeSequentialFiles(f.adapter, f.files, (event) => events.push(event))).toBeNull()
  expect(f.probe.size).toBe(0)
  expect(JSON.stringify(events)).toContain('sample failure')
})

it('uses the same sequential probe in the plugin diagnostic and large-file preflight', async () => {
  const f = setup()
  vi.stubGlobal('Capacitor', { Plugins: { Filesystem: f.files } })
  const io = new BoundedVaultIo(f.adapter)
  const diagnostic = await io.diagnoseMobile()
  expect(diagnostic).toMatchObject({ available: true, mode: 'sequential' })
  expect(
    diagnostic.events.filter((event) => event.step === 'chunk').map((event) => event.bytes)
  ).toEqual([4096, 4096, 4096, 4096, 4096])
  await io.requireTransfer(200 * 1024 * 1024)
  const source = await io.openRead('sample.bin')
  expect((await source.read(0, 1024 * 1024))[0]).toBe(73)
  await source.close()
  expect(f.probe.size).toBe(0)
})

it('rejects oversized native callbacks before decoding or retaining their bytes', async () => {
  const f = setup()
  const capability = await probeSequentialFiles(f.adapter, f.files)
  f.files.readFileInChunks.mockImplementation(async (_options, callback) => {
    callback({ data: 'I'.repeat(2 * 1024 * 1024) })
    callback({ data: null })
    return 'sample'
  })
  const source = capability!.open('sample.bin', f.content.length)
  await expect(source.read(0, 1024 * 1024)).rejects.toThrow('Oversized')
  await source.close()
})

it('refuses cancelled reads without starting a native stream', async () => {
  const f = setup()
  const capability = await probeSequentialFiles(f.adapter, f.files)
  f.files.readFileInChunks.mockClear()
  const source = capability!.open('sample.bin', f.content.length),
    controller = new AbortController()
  controller.abort(new Error('sample cancellation'))
  await expect(source.read(0, 1024 * 1024, controller.signal)).rejects.toThrow(
    'sample cancellation'
  )
  expect(f.files.readFileInChunks).not.toHaveBeenCalled()
  await source.close()
})

it('maps resource URLs to file URLs, decoded absolute paths and Documents-relative options', () => {
  const adapter = {
    getResourcePath: () =>
      'capacitor://localhost/_capacitor_file_/sample/Documents/sample-vault/a%20b.bin?v=1',
  } as unknown as DataAdapter
  expect(mobilePaths(adapter, 'a b.bin')).toEqual([
    { path: 'file:///sample/Documents/sample-vault/a%20b.bin' },
    { path: '/sample/Documents/sample-vault/a b.bin' },
    { path: 'sample-vault/a b.bin', directory: 'DOCUMENTS' },
  ])
})

it('cancels a pending read and drains the native callback before closing', async () => {
  const f = setup(),
    capability = await probeSequentialFiles(f.adapter, f.files)
  let emit!: (result: { data: string | null }) => void
  f.files.readFileInChunks.mockImplementation(async (_options, callback) => {
    emit = callback
    return 'sample'
  })
  const source = capability!.open('sample.bin', f.content.length),
    controller = new AbortController()
  const reading = source.read(0, 1024 * 1024, controller.signal)
  controller.abort(new Error('sample cancellation'))
  await expect(reading).rejects.toThrow('sample cancellation')
  let closed = false
  const closing = source.close().then(() => {
    closed = true
  })
  await Promise.resolve()
  expect(closed).toBe(false)
  emit({ data: null })
  await closing
  expect(closed).toBe(true)
})
