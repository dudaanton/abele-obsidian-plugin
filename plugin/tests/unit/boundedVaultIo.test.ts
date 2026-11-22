import { mobileReadSnapshot } from '@/sync/mobileReadDiagnostics'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { desktopFsPort } from '../helpers/desktopRequire'
import type { DataAdapter } from 'obsidian'
import { BoundedVaultIo } from '@/sync/boundedVaultIo'
import { vaultInstallationEpoch } from '@/sync/installationEpoch'
import { mobileStreamFixture } from '../helpers/mobileStreamFixture'
import { buildFakeVault } from '../helpers/fakeVault'
import { sha256 } from '@noble/hashes/sha2'

const digest = (bytes: Uint8Array) =>
  Array.from(sha256(bytes), (b) => b.toString(16).padStart(2, '0')).join('')

it.each(['append', 'fingerprint', 'resume'])(
  'does not trust a rebuilt receipt after another same-stat overwrite (%s)',
  async (reader) => {
    const app = buildFakeVault([])
    const io = new BoundedVaultIo(app.vault.adapter as never)
    await io.create('sample.bin', 1000)
    await io.append('sample.bin', 0, new Uint8Array([1, 2, 3]), 1000)
    await app.vault.adapter.writeBinary('sample.bin', new Uint8Array([3, 2, 1]).buffer, {
      mtime: 1000,
    })
    await io.append('sample.bin', 3, new Uint8Array([4]), 1000)
    await app.vault.adapter.writeBinary('sample.bin', new Uint8Array([4, 3, 2, 1]).buffer, {
      mtime: 1000,
    })
    if (reader === 'resume') expect(await io.canResumeStage('sample.bin')).toBe(false)
    else {
      if (reader === 'append') await io.append('sample.bin', 4, new Uint8Array([5]), 1000)
      const actual = new Uint8Array(await app.vault.adapter.readBinary('sample.bin'))
      expect((await io.fingerprint('sample.bin')).sha).toBe(digest(actual))
    }
  }
)

it.each(['clean', 'before', 'during', 'after', 'event'])(
  'transfers only the receipt bound throughout an owned rename (%s)',
  async (when) => {
    const app = buildFakeVault([])
    const io = new BoundedVaultIo(
      app.vault.adapter as never,
      undefined,
      undefined,
      app.vault.adapter,
      undefined,
      undefined,
      false,
      vaultInstallationEpoch(app.vault as never)
    )
    const original = new Uint8Array([1, 2, 3])
    await io.create('stage.bin', 1000)
    await io.append('stage.bin', 0, original, 1000)
    const overwrite = (path: string) =>
      app.vault.adapter.writeBinary(path, new Uint8Array([3, 2, 1]).buffer, { mtime: 1000 })
    if (when === 'before') await overwrite('stage.bin')
    if (when === 'during') {
      const rename = app.vault.adapter.rename.bind(app.vault.adapter)
      vi.spyOn(app.vault.adapter, 'rename').mockImplementationOnce(async (from, to) => {
        await overwrite(from)
        await rename(from, to)
      })
    }
    const read = vi.spyOn(app.vault.adapter, 'readBinary')
    await io.adoptReceipt('stage.bin', 'sample.bin', async () => {
      if (when === 'event') app.emit('vault', 'modify', { path: 'stage.bin' })
      await app.vault.adapter.rename('stage.bin', 'sample.bin')
      if (when === 'after') await overwrite('sample.bin')
    })
    expect(await io.verifiedInstallation('sample.bin', { sha: digest(original), size: 3 })).toBe(
      when === 'clean'
    )
    expect(read).not.toHaveBeenCalled()
  }
)

it('does not renew a prefix receipt across an intervening write during append', async () => {
  const app = buildFakeVault([])
  const io = new BoundedVaultIo(app.vault.adapter as never)
  await io.create('sample.bin', 1000)
  await io.append('sample.bin', 0, new Uint8Array([1, 2, 3]), 1000)
  const write = app.vault.adapter.writeBinary.bind(app.vault.adapter)
  vi.spyOn(app.vault.adapter, 'writeBinary').mockImplementationOnce(
    async (path, bytes, options) => {
      await write(path, bytes, options)
      await write(path, new Uint8Array([4, 3, 2, 1]).buffer, options)
    }
  )
  await io.append('sample.bin', 3, new Uint8Array([4]), 1000)
  expect(
    await io.verifiedInstallation('sample.bin', {
      sha: digest(new Uint8Array([1, 2, 3, 4])),
      size: 4,
    })
  ).toBe(false)
  expect((await io.fingerprint('sample.bin')).sha).toBe(digest(new Uint8Array([4, 3, 2, 1])))
})

it('does not renew invalid publication evidence from a supplied write hash', async () => {
  const app = buildFakeVault([])
  const io = new BoundedVaultIo(app.vault.adapter as never)
  const original = new Uint8Array([1, 2, 3])
  await io.create('sample.bin', 1000)
  await io.append('sample.bin', 0, original, 1000)
  await app.vault.adapter.writeBinary('sample.bin', new Uint8Array([3, 2, 1]).buffer, {
    mtime: 1000,
  })
  await io.recordWrite('sample.bin', 3, sha256.create().update(original), true)
  expect(await io.verifiedInstallation('sample.bin', { sha: digest(original), size: 3 })).toBe(
    false
  )
})

it('upgrades legacy adapter observation before binding byte receipts', async () => {
  const app = buildFakeVault([])
  const adapter = app.vault.adapter
  const revisions = Symbol.for('abele.sync.adapter-config-revisions-v1')
  const observers = Symbol.for('abele.sync.adapter-config-observers-v1')
  Object.defineProperty(adapter, revisions, { value: new Map([['', 0]]) })
  Object.defineProperty(adapter, observers, { value: new Set() })
  const raw = adapter.writeBinary.bind(adapter)
  adapter.writeBinary = async (path, bytes, options) => {
    const notify = () => {
      for (const observe of Reflect.get(adapter, observers)) observe([path], false)
    }
    notify()
    try {
      await raw(path, bytes, options)
    } finally {
      notify()
    }
  }
  const io = new BoundedVaultIo(adapter as never)
  const bytes = new Uint8Array([1, 2, 3])
  await io.create('sample.bin', 1000)
  await io.append('sample.bin', 0, bytes, 1000)
  expect(await io.verifiedInstallation('sample.bin', { sha: digest(bytes), size: 3 })).toBe(true)
  await adapter.writeBinary('sample.bin', new Uint8Array([3, 2, 1]).buffer, { mtime: 1000 })
  expect(await io.verifiedInstallation('sample.bin', { sha: digest(bytes), size: 3 })).toBe(false)
})

it('does not bind an earlier binary buffer across a later text mutation', async () => {
  const app = buildFakeVault([])
  const adapter = app.vault.adapter
  const rawWrite = adapter.writeBinary.bind(adapter)
  const changed = new Uint8Array([4, 3, 2, 1])
  Object.assign(adapter, {
    process: async (path: string) => rawWrite(path, changed.buffer, { mtime: 1000 }),
  })
  const io = new BoundedVaultIo(adapter as never)
  await io.create('sample.bin', 1000)
  await io.append('sample.bin', 0, new Uint8Array([1, 2, 3]), 1000)
  const write = adapter.writeBinary.bind(adapter)
  vi.spyOn(adapter, 'writeBinary').mockImplementationOnce(async (path, bytes, options) => {
    await write(path, bytes, options)
    await Reflect.get(adapter, 'process')(path)
  })
  await io.append('sample.bin', 3, new Uint8Array([4]), 1000)
  expect((await io.fingerprint('sample.bin')).sha).toBe(digest(changed))
})

it('does not admit a read receipt while a same-stat host write is still in flight', async () => {
  const app = buildFakeVault([{ path: 'sample.bin', content: 'old', mtime: 1000 }])
  const adapter = app.vault.adapter
  const rawWrite = adapter.writeBinary.bind(adapter)
  let start!: () => void, acknowledge!: () => void, written!: () => void
  const begin = new Promise<void>((resolve) => {
    start = resolve
  })
  const ack = new Promise<void>((resolve) => {
    acknowledge = resolve
  })
  const changed = new Promise<void>((resolve) => {
    written = resolve
  })
  adapter.writeBinary = async (path, bytes, options) => {
    await begin
    await rawWrite(path, bytes, options)
    written()
    await ack
  }
  const io = new BoundedVaultIo(
    adapter as never,
    undefined,
    undefined,
    adapter,
    undefined,
    undefined,
    true
  )
  const pending = adapter.writeBinary('sample.bin', new TextEncoder().encode('new').buffer, {
    mtime: 1000,
  })
  try {
    await expect(io.fingerprint('sample.bin')).rejects.toMatchObject({ code: 'conflict' })
    start()
    await changed
    await expect(io.fingerprint('sample.bin')).rejects.toMatchObject({ code: 'conflict' })
  } finally {
    start()
    acknowledge()
    await pending
  }
  expect((await io.fingerprint('sample.bin')).sha).toBe(digest(new TextEncoder().encode('new')))
})

it('does not adopt a renamed receipt after a same-stat destination overwrite', async () => {
  const app = buildFakeVault([])
  const io = new BoundedVaultIo(app.vault.adapter as never)
  const original = new Uint8Array([1, 2, 3])
  await io.create('stage.bin', 1000)
  await io.append('stage.bin', 0, original, 1000)
  await app.vault.adapter.rename('stage.bin', 'sample.bin')
  await app.vault.adapter.writeBinary('sample.bin', new Uint8Array([3, 2, 1]).buffer, {
    mtime: 1000,
  })
  await io.adoptReceipt('stage.bin', 'sample.bin')
  expect(await io.verifiedInstallation('sample.bin', { sha: digest(original), size: 3 })).toBe(
    false
  )
  expect((await io.fingerprint('sample.bin')).sha).toBe(digest(new Uint8Array([3, 2, 1])))
})

it.each([false, true])(
  'binds prepared write metadata only while its epoch survives (changed=%s)',
  async (changed) => {
    let stored = new Uint8Array([1, 2, 3]).buffer
    const readBinary = vi.fn(async () => stored)
    const adapter = {
      stat: async () => ({ type: 'file', size: 3, mtime: 2000, ctime: 2 }),
      writeBinary: async (_path: string, bytes: ArrayBuffer) => {
        stored = bytes
      },
      readBinary,
    } as unknown as DataAdapter
    const io = new BoundedVaultIo(adapter)
    const bytes = new Uint8Array([1, 2, 3])
    await io.create('sample.bin', 1000, 'acknowledged', bytes, true)
    if (changed) await adapter.writeBinary('sample.bin', new Uint8Array([3, 2, 1]).buffer)
    expect(await io.verifiedInstallation('sample.bin', { size: 3, sha: digest(bytes) })).toBe(
      !changed
    )
    expect((await io.fingerprint('sample.bin')).sha).toBe(digest(new Uint8Array(stored)))
    expect(readBinary).toHaveBeenCalledTimes(changed ? 1 : 0)
  }
)

it('rejects a large portable fingerprint changed during upload consumption', async () => {
  const size = 51 * 1024 * 1024
  let fill = 1
  const adapter = {
    stat: async () => ({ type: 'file', size, mtime: 1000, ctime: 1 }),
    readBinary: async () => new Uint8Array(size).fill(fill).buffer,
    writeBinary: async () => {
      fill = 2
    },
  } as unknown as DataAdapter
  const io = new BoundedVaultIo(adapter)
  await expect(
    io.fingerprintForUpload('sample.bin', async () => {
      await adapter.writeBinary('sample.bin', new ArrayBuffer(0))
    })
  ).rejects.toMatchObject({ code: 'conflict' })
}, 30000)

it.each([false, true])(
  'rejects a fresh fingerprint changed during reading (metadata receipts %s)',
  async (metadataReceipts) => {
    let stored = new Uint8Array([1, 2, 3]).buffer
    let mutate = true
    const adapter = {
      stat: async () => ({ type: 'file', size: 3, mtime: 1000, ctime: 1 }),
      readBinary: async () => {
        const bytes = stored
        if (mutate) {
          mutate = false
          await adapter.writeBinary('sample.bin', new Uint8Array([3, 2, 1]).buffer)
        }
        return bytes
      },
      writeBinary: async (_path: string, bytes: ArrayBuffer) => {
        stored = bytes
      },
    } as unknown as DataAdapter
    const io = new BoundedVaultIo(
      adapter,
      undefined,
      undefined,
      adapter,
      undefined,
      undefined,
      metadataReceipts
    )
    await expect(io.fingerprint('sample.bin', undefined, false, true)).rejects.toMatchObject({
      code: 'conflict',
    })
    expect((await io.fingerprint('sample.bin', undefined, false, true)).sha).toBe(
      digest(new Uint8Array([3, 2, 1]))
    )
  }
)

it('uploads changed large portable bytes despite an acknowledged same-stat receipt', async () => {
  const size = 51 * 1024 * 1024
  let fill = 1
  const readBinary = vi.fn(async () => new Uint8Array(size).fill(fill).buffer)
  const adapter = {
    stat: async () => ({ type: 'file', size, mtime: 1000, ctime: 1 }),
    readBinary,
    writeBinary: async () => {
      fill = 2
    },
  } as unknown as DataAdapter
  const io = new BoundedVaultIo(adapter)
  const consume = vi.fn(async () => {})
  const first = await io.fingerprintForUpload('sample.bin', consume)
  await adapter.writeBinary('sample.bin', new ArrayBuffer(0))
  const second = await io.fingerprintForUpload(
    'sample.bin',
    consume,
    undefined,
    (id) => id.sha === first!.sha
  )
  expect(second!.sha).not.toBe(first!.sha)
  const third = await io.fingerprintForUpload(
    'sample.bin',
    consume,
    undefined,
    (id) => id.sha === second!.sha
  )
  expect(third!.sha).toBe(second!.sha)
  expect(consume).toHaveBeenCalledTimes(2)
  expect(readBinary).toHaveBeenCalledTimes(2)
}, 30000)

it('does not extend an invalidated installation receipt after a same-stat overwrite', async () => {
  const app = buildFakeVault([])
  const io = new BoundedVaultIo(app.vault.adapter as never)
  await io.create('sample.bin', 1000)
  await io.append('sample.bin', 0, new Uint8Array([1, 2, 3]), 1000)
  const before = await app.vault.adapter.stat('sample.bin')
  await app.vault.adapter.writeBinary('sample.bin', new Uint8Array([3, 2, 1]).buffer, {
    mtime: 1000,
  })
  expect(await app.vault.adapter.stat('sample.bin')).toEqual(before)
  await io.append('sample.bin', 3, new Uint8Array([4]), 1000)
  const stale = Array.from(sha256(new Uint8Array([1, 2, 3, 4])), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('')
  expect(await io.verifiedInstallation('sample.bin', { sha: stale, size: 4 })).toBe(false)
  expect(new Uint8Array(await app.vault.adapter.readBinary('sample.bin'))).toEqual(
    new Uint8Array([3, 2, 1, 4])
  )
  expect((await io.fingerprint('sample.bin')).sha).not.toBe(stale)
})

it.each(['before', 'during-stat'])(
  'does not reuse an owned stage hash after a same-stat host mutation (%s)',
  async (when) => {
    const app = buildFakeVault([])
    const io = new BoundedVaultIo(app.vault.adapter as never)
    await io.create('sample.bin', 1000)
    await io.append('sample.bin', 0, new Uint8Array([1, 2, 3]), 1000)
    const before = await io.fingerprint('sample.bin')
    const mutate = () =>
      app.vault.adapter.writeBinary('sample.bin', new Uint8Array([3, 2, 1]).buffer, {
        mtime: 1000,
      })
    if (when === 'before') await mutate()
    else {
      const stat = app.vault.adapter.stat.bind(app.vault.adapter)
      vi.spyOn(app.vault.adapter, 'stat').mockImplementationOnce(async (path) => {
        await mutate()
        return stat(path)
      })
    }
    expect((await io.fingerprint('sample.bin')).sha).not.toBe(before.sha)
  }
)

it('attests portable installs only while the recorded mutation epoch and receipt remain active', async () => {
  const app = buildFakeVault([])
  const io = new BoundedVaultIo(app.vault.adapter as never)
  const bytes = new Uint8Array([1, 2, 3])
  await io.create('sample.bin', 1000)
  await io.append('sample.bin', 0, bytes, 1000)
  const expected = {
    size: 3,
    sha: Array.from(sha256(bytes), (b) => b.toString(16).padStart(2, '0')).join(''),
  }
  const read = vi.spyOn(app.vault.adapter, 'readBinary')
  read.mockClear()
  expect(await io.verifiedInstallation('sample.bin', expected)).toBe(true)
  expect(await io.verifiedInstallation('sample.bin', { ...expected, sha: 'a'.repeat(64) })).toBe(
    false
  )
  await app.vault.adapter.writeBinary('sample.bin', bytes.buffer, { mtime: 1000 })
  expect(await io.verifiedInstallation('sample.bin', expected)).toBe(false)
  await io.recordWrite('sample.bin', 3, sha256.create().update(bytes))
  expect(await io.verifiedInstallation('sample.bin', expected)).toBe(true)
  io.invalidateInstallations('sample.bin')
  expect(await io.verifiedInstallation('sample.bin', expected)).toBe(false)
  expect(read).not.toHaveBeenCalled()
})

const MiB = 1024 * 1024
afterEach(() => vi.unstubAllGlobals())

it('allows an admitted 64 MiB source and refuses larger eager sources before reading', async () => {
  let size = 64 * MiB
  const readBinary = vi.fn()
  const adapter = {
    stat: async () => ({ type: 'file', size, mtime: 1, ctime: 1 }),
    readBinary,
  } as unknown as DataAdapter
  const io = new BoundedVaultIo(adapter)
  const source = await io.openRead('sample.bin', undefined, size)
  expect(source.size).toBe(size)
  await source.close()
  size++
  await expect(io.openRead('sample.bin', undefined, size)).rejects.toThrow('64 MiB')
  expect(readBinary).not.toHaveBeenCalled()
})

it('shares one mobile probe when a native proxy returns fresh method wrappers', async () => {
  const fixture = mobileStreamFixture()
  const capacitor = Reflect.get(window, 'Capacitor')
  const files = capacitor.Plugins.Filesystem
  const probe = vi.spyOn(fixture.adapter, 'writeBinary')
  await new BoundedVaultIo(fixture.adapter).canReplayStage()
  const baseline = probe.mock.calls.length
  probe.mockClear()
  let reads = 0
  capacitor.Plugins.Filesystem = new Proxy(
    {},
    {
      get(_target, key) {
        const value = Reflect.get(files, key)
        // Bound the broken implementation's retry loop so a red test also drains.
        return typeof value === 'function' && reads++ < 24
          ? (...args: unknown[]) => value.apply(files, args)
          : value
      },
    }
  )
  const io = new BoundedVaultIo(fixture.adapter)
  // Two overlapping consumers must join the same capability attempt, not
  // invalidate each other's in-flight probe because native wrappers differ.
  await Promise.all([io.canReplayStage(), io.canReplayStage()])
  const count = probe.mock.calls.length
  expect(count).toBe(baseline)
  await io.canReplayStage()
  expect(probe).toHaveBeenCalledTimes(count)
})

it('shares verified mobile capabilities across operation ports and reprobes after a fresh poll', async () => {
  const fixture = mobileStreamFixture()
  const base = new BoundedVaultIo(fixture.adapter)
  const operation = new BoundedVaultIo(fixture.adapter)
  operation.reuseCapabilitiesFrom(base)
  const available = await base.canReplayStage()
  const probes = fixture.fetcher.mock.calls.length
  expect(probes).toBeGreaterThan(0)
  expect(await operation.canReplayStage()).toBe(available)
  expect(fixture.fetcher.mock.calls.length).toBe(probes)
  base.invalidateCapabilities()
  expect(await operation.canReplayStage()).toBe(available)
  expect(fixture.fetcher.mock.calls.length).toBeGreaterThan(probes)
  const files = Reflect.get(window, 'Capacitor').Plugins.Filesystem
  const original = files.readFile
  files.readFile = async (options: { path: string; offset: number; length: number }) => {
    const answer = await original(options)
    return { data: btoa(atob(answer.data).slice(options.offset, options.offset + options.length)) }
  }
  expect(await operation.canReplayStage()).toBe(true)
})

describe('bounded vault I/O', () => {
  it.each([
    [true, false],
    [false, false],
    [true, true],
  ])(
    'probes mobile path mapping and offset support before reading a virtual large file (ranges=%s, resource=%s)',
    async (ranges, resource) => {
      const size = 3 * 1024 * MiB + 13
      const probes = new Map<string, Uint8Array>()
      const folders = new Set<string>()
      const readBinary = vi.fn(() => {
        throw new Error('whole file')
      })
      const calls: { offset: number; length: number; chunkSize: number; path: string }[] = []
      const adapter = {
        ...(resource
          ? {
              getResourcePath: (path: string) =>
                'capacitor://localhost/_capacitor_file_/sample/' + path + '?v=1',
            }
          : { getFullPath: (path: string) => 'file:///sample/' + path }),
        exists: async (path: string) => probes.has(path) || folders.has(path),
        mkdir: async (path: string) => {
          folders.add(path)
        },
        stat: async (path: string) => ({
          type: 'file',
          size: probes.get(path)?.length ?? size,
          mtime: 1,
          ctime: 1,
        }),
        writeBinary: async (path: string, bytes: ArrayBuffer) => {
          probes.set(path, new Uint8Array(bytes))
        },
        remove: async (path: string) => {
          probes.delete(path)
        },
        readBinary,
      } as unknown as DataAdapter
      const readFileInChunks = vi.fn(async (options, callback) => {
        calls.push(options)
        expect(options.path).toMatch(/^file:\/\/\/sample\//)
        expect(options.chunkSize).toBeLessThanOrEqual(MiB)
        const probe = probes.get(options.path.slice('file:///sample/'.length))
        if (!probe) throw new Error('unexpected read before range capability was verified')
        const bytes = probe
          ? ranges
            ? probe.slice(options.offset, options.offset + options.length)
            : probe
          : new Uint8Array()
        callback({ data: btoa(String.fromCharCode(...bytes.slice(0, Math.min(bytes.length, 4)))) })
        callback({ data: '' })
        return 'sample-callback'
      })
      vi.stubGlobal('Capacitor', {
        Plugins: {
          Filesystem: {
            stat: async ({ path }: { path: string }) => ({
              size: probes.get(path.slice('file:///sample/'.length))?.length ?? size,
            }),
            readFileInChunks,
            readFile: async (options: { path: string; offset: number; length: number }) => {
              calls.push({ ...options, chunkSize: options.length })
              const probe = probes.get(options.path.slice('file:///sample/'.length))
              const part = probe
                ? ranges
                  ? probe.slice(options.offset, options.offset + options.length)
                  : probe
                : null
              return {
                data: part ? btoa(String.fromCharCode(...part)) : btoa('I'.repeat(options.length)),
              }
            },
          },
        },
      })
      const io = new BoundedVaultIo(adapter)
      if (!ranges) {
        await expect(io.openRead('sample.bin')).rejects.toThrow('50 MiB')
      } else {
        const source = await io.openRead('sample.bin')
        readFileInChunks.mockImplementation(async (options, callback) => {
          calls.push(options)
          expect(options.chunkSize).toBeLessThanOrEqual(MiB)
          callback({ data: btoa('I'.repeat(options.length)) })
          callback({ data: '' })
          return 'sample-callback'
        })
        for (const offset of [0, 2 * 1024 * MiB, size - 13]) {
          const bytes = await source.read(offset, Math.min(MiB, size - offset))
          expect(bytes.buffer.byteLength).toBeLessThanOrEqual(MiB)
          expect(bytes[0]).toBe(73)
        }
        await source.close()
        expect(calls.filter((call) => call.offset !== undefined)).toHaveLength(4)
      }
      expect(probes.size).toBe(0)
      expect(readBinary).not.toHaveBeenCalled()
    }
  )
  it('reads a virtual multi-GiB native file without a whole-file allocation', async () => {
    const size = 3 * 1024 * MiB + 13
    let largest = 0
    const close = vi.fn(async () => {})
    const adapter = {
      stat: async () => ({ type: 'file', size, mtime: 10, ctime: 1 }),
      getFullPath: (path: string) => '/sample/' + path,
      fsPromises: {
        lstat: async () => ({ dev: 1, ino: 1, isSymbolicLink: () => false }),
        open: async () => ({
          stat: async () => ({ dev: 1, ino: 1 }),
          read: async (buffer: Uint8Array, _at: number, length: number, position: number) => {
            largest = Math.max(largest, buffer.buffer.byteLength)
            expect(buffer.buffer.byteLength).toBeLessThanOrEqual(MiB)
            buffer.fill(position % 251)
            return { bytesRead: length }
          },
          close,
        }),
      },
      readBinary: () => {
        throw new Error('whole file read')
      },
    } as unknown as DataAdapter
    desktopFsPort(Reflect.get(adapter, 'fsPromises'))
    const source = await new BoundedVaultIo(adapter).openRead('sample.bin')
    for (let offset = 0; offset < size; offset += MiB) {
      const bytes = await source.read(offset, Math.min(MiB, size - offset))
      expect(bytes[0]).toBe(offset % 251)
    }
    await source.assertUnchanged()
    await source.close()
    await source.close()
    expect(close).toHaveBeenCalledTimes(1)
    expect(largest).toBe(MiB)
  })
  it('refuses non-upload portable reads above 50 MiB before invoking the adapter', async () => {
    const readBinary = vi.fn()
    const adapter = {
      stat: async () => ({ type: 'file', size: 51 * MiB, mtime: 1, ctime: 1 }),
      readBinary,
    } as unknown as DataAdapter
    await expect(new BoundedVaultIo(adapter).openRead('sample.bin')).rejects.toThrow('50 MiB')
    expect(readBinary).not.toHaveBeenCalled()
  })
  it('accepts an existing file exactly at the portable read limit', async () => {
    const readBinary = vi.fn(async () => new ArrayBuffer(50 * MiB))
    const adapter = {
      stat: async () => ({ type: 'file', size: 50 * MiB, mtime: 1, ctime: 1 }),
      readBinary,
    } as unknown as DataAdapter
    const source = await new BoundedVaultIo(adapter).openRead('sample.bin')
    expect(await source.read(50 * MiB - 1, 1)).toEqual(new Uint8Array([0]))
    await source.close()
    expect(readBinary).toHaveBeenCalledTimes(1)
  })
  it('retains oversized partial bytes but refuses recovery after an uncertain append or lost receipt', async () => {
    const abort = new AbortController()
    let cancelWithAcknowledgement = false
    let size = 0,
      mtime = 0,
      uncertain = false
    const readBinary = vi.fn(async () => {
      throw new Error('whole file')
    })
    const adapter = {
      stat: async () => ({ type: 'file', size, mtime, ctime: 1 }),
      writeBinary: async () => {
        size = 0
        mtime++
      },
      appendBinary: async (_path: string, bytes: ArrayBuffer) => {
        size += bytes.byteLength
        mtime++
        if (uncertain) throw new Error('acknowledgement lost')
        if (cancelWithAcknowledgement) abort.abort(new Error('cancelled'))
      },
      readBinary,
    } as unknown as DataAdapter
    const io = new BoundedVaultIo(adapter),
      chunk = new Uint8Array(MiB)
    await io.create('sample.tmp', 1)
    for (let at = 0; at < 50 * MiB; at += MiB) await io.append('sample.tmp', at, chunk, 1)
    cancelWithAcknowledgement = true
    await expect(io.append('sample.tmp', size, chunk, 1, abort.signal)).rejects.toThrow('cancelled')
    cancelWithAcknowledgement = false
    expect(await io.fingerprint('sample.tmp')).toMatchObject({ size: 51 * MiB })
    // A process restart has no acknowledgement history, even when the path and stamp survive.
    const restarted = new BoundedVaultIo(adapter, undefined, undefined, {})
    await expect(restarted.fingerprint('sample.tmp', undefined, true)).rejects.toThrow(
      'bounded local verification'
    )
    uncertain = true
    await expect(io.append('sample.tmp', size, chunk, 1)).rejects.toThrow('acknowledgement lost')
    uncertain = false
    await expect(io.append('sample.tmp', size, chunk, 1)).rejects.toThrow('50 MiB')
    await expect(io.fingerprint('sample.tmp', undefined, true)).rejects.toThrow(
      'bounded local verification'
    )
    expect(size).toBe(52 * MiB)
    expect(readBinary).not.toHaveBeenCalled()
  })
  it('checks cancellation and rejects changes to an opened source', async () => {
    let mtime = 1
    const readBinary = vi.fn(async () => new Uint8Array(4).buffer)
    const adapter = {
      stat: async () => ({ type: 'file', size: 4, mtime, ctime: 1 }),
      readBinary,
    } as unknown as DataAdapter
    const source = await new BoundedVaultIo(adapter).openRead('sample.bin')
    const abort = new AbortController()
    abort.abort(new Error('cancelled'))
    await expect(source.read(0, 4, abort.signal)).rejects.toThrow('cancelled')
    mtime++
    await expect(source.assertUnchanged()).rejects.toThrow('changed')
    await source.close()
  })
})

it.each(['create', 'append'])(
  'refuses linked staging ancestors before native %s',
  async (action) => {
    const open = vi.fn(async () => ({
      sync: async () => {},
      close: async () => {},
      write: async () => ({ bytesWritten: 1 }),
    }))
    const adapter = {
      getFullPath: (p: string) => '/vault/' + p,
      stat: async () => ({ type: 'file', size: 0, mtime: 1, ctime: 1 }),
      fsPromises: {
        open,
        lstat: async (p: string) => ({
          isSymbolicLink: () => p === '/vault/.obsidian/sync-staging',
          isDirectory: () => p !== '/vault/.obsidian/sync-staging',
        }),
      },
    } as unknown as DataAdapter
    const io = new BoundedVaultIo(adapter)
    const path = '.obsidian/sync-staging/sample.tmp'
    await expect(
      action === 'create' ? io.create(path, 1) : io.append(path, 0, new Uint8Array([1]), 1)
    ).rejects.toThrow(/symbolic link/i)
    expect(open).not.toHaveBeenCalled()
  }
)

it('reads a small mobile file without per-file resource fetch overhead', async () => {
  const bytes = new Uint8Array(8200).fill(7)
  const readBinary = vi.fn(async () => bytes.buffer)
  const fetcher = vi.fn(() => {
    throw new Error('unexpected local fetch')
  })
  vi.stubGlobal('fetch', fetcher)
  const adapter = {
    getResourcePath: () => 'capacitor://localhost/_capacitor_file_/sample/sample.md',
    exists: async () => false,
    mkdir: async () => {},
    writeBinary: async () => {},
    remove: async () => {},
    stat: async () => ({ type: 'file', size: bytes.length, mtime: 1, ctime: 1 }),
    readBinary,
  } as unknown as DataAdapter
  const source = await new BoundedVaultIo(adapter).openRead('sample.md')
  try {
    expect(await source.read(0, bytes.length)).toEqual(bytes)
  } finally {
    await source.close()
  }
  expect(readBinary).toHaveBeenCalledOnce()
  expect(fetcher).not.toHaveBeenCalled()
})

it('keeps small reads on the adapter after a whole-file upload read', async () => {
  const f = mobileStreamFixture()
  const originalStat = f.adapter.stat.bind(f.adapter)
  f.adapter.stat = async (path) =>
    path === 'small.md' ? { type: 'file', size: 8, mtime: 1, ctime: 1 } : originalStat(path)
  const smallRead = vi.fn(
    async (path: string) => new Uint8Array(path === 'small.md' ? 8 : f.size).buffer
  )
  f.adapter.readBinary = smallRead
  const io = new BoundedVaultIo(f.adapter)
  const large = await io.openUploadRead('sample.bin')
  await large.read(0, MiB)
  await large.close()
  const before = f.fetcher.mock.calls.length
  const small = await io.openRead('small.md')
  try {
    expect(await small.read(0, 8)).toEqual(new Uint8Array(8))
  } finally {
    await small.close()
  }
  expect(f.fetcher.mock.calls.length).toBe(before)
  expect(smallRead).toHaveBeenCalledTimes(2)
})

it('keeps a 2 MiB mobile file on the original adapter path without large-upload diagnostics or resource probes', async () => {
  const fixture = mobileStreamFixture(2 * MiB)
  const before = mobileReadSnapshot()
  const io = new BoundedVaultIo(fixture.adapter)
  const source = await io.openRead('sample.bin')
  try {
    expect((await source.read(0, MiB)).length).toBe(MiB)
  } finally {
    await source.close()
  }
  expect(fixture.readBinary).toHaveBeenCalledOnce()
  expect(fixture.fetcher).not.toHaveBeenCalled()
  expect(fixture.readFileInChunks).not.toHaveBeenCalled()
  expect(fixture.readFile).not.toHaveBeenCalled()
  expect(mobileReadSnapshot().wholeReads).toBe(before.wholeReads)
})
