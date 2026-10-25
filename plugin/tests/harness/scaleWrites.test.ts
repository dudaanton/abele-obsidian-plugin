// @vitest-environment node
import { expect, it } from 'vitest'
import { createRequire } from 'node:module'
import * as fsp from 'node:fs/promises'
import { join } from 'node:path'
const require = createRequire(import.meta.url)

it('records durability barriers on readonly file and directory handles without observing payload reads', async () => {
  const { observeWrites } = require('../scale/writes.cjs')
  const events = []
  const handle = { sync: async () => 7, datasync: async () => 8, read: async () => 9 }
  const native = { open: async () => ({ ...handle }), rename: async () => {} }
  const undo = observeWrites(
    { getBasePath: () => '/sample', fsPromises: native, writeBinary: async () => {} },
    (event) => events.push(event)
  )
  try {
    const opened = await native.open('/sample/folder', 'r')
    expect(await opened.sync()).toBe(7)
    expect(await opened.datasync()).toBe(8)
    expect(await opened.read()).toBe(9)
    expect(events.filter((e) => e.event === 'write-start').map((e) => e.method)).toEqual([
      'handle.sync',
      'handle.datasync',
    ])
    expect(events.filter((e) => e.event === 'write-finish')).toHaveLength(2)
    const root = await native.open('/sample', 'r')
    await root.sync()
    expect(events.filter((e) => e.event === 'write-start').at(-1).path).toBe('.')
  } finally {
    undo()
  }
})

it('preserves filesystem errors and fails observation closed without breaking an uninstrumentable handle', async () => {
  const { observeWrites } = require('../scale/writes.cjs')
  const error = new Error('sample failure')
  const handle = Object.freeze({ write: async () => ({ bytesWritten: 1 }) })
  const native = {
    open: async () => handle,
    rename: async () => {},
    writeFile: async () => {
      throw error
    },
  }
  const adapter = { getBasePath: () => '/sample', fsPromises: native, writeBinary: async () => {} }
  const events = []
  const undo = observeWrites(adapter, (e) => events.push(e))
  try {
    await expect(native.writeFile('/sample/fail.md', Buffer.from('a'))).rejects.toBe(error)
    expect(await native.open('/sample/sample.md', 'w')).toBe(handle)
    expect(events.some((e) => e.event === 'write-observer-error')).toBe(true)
  } finally {
    undo()
  }
})

it('observes native handle writes and atomic installs without altering results, then restores the ports', async () => {
  const { observeWrites } = require('../scale/writes.cjs')
  const root = await fsp.mkdtemp(join(process.cwd(), '.scratch/scale-writes-'))
  const native = { ...fsp }
  const adapter = {
    getBasePath: () => root,
    fsPromises: native,
    writeBinary: (path, bytes) => native.writeFile(join(root, path), bytes),
  }
  const original = native.open,
    events = []
  const undo = observeWrites(adapter, (event) => events.push(event))
  try {
    const handle = await native.open(join(root, 'sample.part'), 'w')
    const result = await handle.write(Buffer.from('abc'), 0, 3, 0)
    expect(result.bytesWritten).toBe(3)
    await handle.close()
    await native.rename(join(root, 'sample.part'), join(root, 'sample.md'))
    await adapter.writeBinary('other.md', Buffer.from('xy'))
    expect(await fsp.readFile(join(root, 'sample.md'), 'utf8')).toBe('abc')
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'write-start',
        method: 'handle.write',
        path: 'sample.part',
        bytes: 3,
      })
    )
    expect(events).toContainEqual(
      expect.objectContaining({ event: 'write-start', method: 'native.rename', path: 'sample.md' })
    )
    expect(events.filter((e) => e.event === 'write-start').length).toBe(
      events.filter((e) => e.event === 'write-finish').length
    )
  } finally {
    undo()
    expect(native.open).toBe(original)
    await fsp.rm(root, { recursive: true, force: true })
  }
})

it('captures write caller stacks and sync durations without changing results', async () => {
  const { observeWrites } = require('../scale/writes.cjs')
  const events = []
  const handle = { sync: async () => 'synced', close: async () => {} }
  const native = { open: async () => handle, rename: async () => {}, writeFile: async () => 7 }
  const adapter = { getBasePath: () => '/sample', fsPromises: native, writeBinary: async () => {} }
  const undo = observeWrites(adapter, (e) => events.push(e))
  try {
    expect(await native.writeFile('/sample/sample.md', 'text')).toBe(7)
    expect(events.find((e) => e.event === 'write-start').stack).toContain('scaleWrites.test.ts')
    const opened = await native.open('/sample/sample.md', 'w')
    expect(await opened.sync()).toBe('synced')
    const sync = events.find((e) => e.method === 'handle.sync')
    const finished = events.find((e) => e.event === 'write-finish' && e.id === sync.id)
    expect(finished.durationMs).toBeGreaterThanOrEqual(0)
  } finally {
    undo()
  }
})

it('observes direct native ports as well as the host adapter without double wrapping shared ports', async () => {
  const { observeWrites } = require('../scale/writes.cjs')
  const events = []
  const handle = { sync: async () => 7 }
  const direct = { open: async () => handle, rename: async () => {} }
  const adapterPort = { open: async () => ({}), rename: async () => {} }
  const adapter = {
    getBasePath: () => '/sample',
    fsPromises: adapterPort,
    writeBinary: async () => {},
  }
  const undo = observeWrites(adapter, (e) => events.push(e), [direct, adapterPort])
  try {
    expect(await (await direct.open('/sample/sample.md', 'w')).sync()).toBe(7)
    expect(events.filter((e) => e.method === 'handle.sync')).toHaveLength(1)
  } finally {
    undo()
  }
})

it('observes actual content read bytes and distinguishes host from sync callers without changing results', async () => {
  const { observeReads } = require('../scale/writes.cjs')
  const events = []
  const handle = { read: async () => ({ bytesRead: 3 }), readFile: async () => Buffer.from('body') }
  const native = { open: async () => handle, readFile: async () => Buffer.from('data') }
  const adapter = { getBasePath: () => '/sample', fsPromises: native, read: async () => 'note' }
  const undo = observeReads(adapter, (e) => events.push(e), [native], 'fixture')
  try {
    expect(await adapter.read('fixture/sample.md')).toBe('note')
    const opened = await native.open('/sample/fixture/sample.md', 'r')
    expect((await opened.read(Buffer.alloc(10), 0, 10, 0)).bytesRead).toBe(3)
    expect(await native.readFile('/sample/.obsidian/workspace.json')).toEqual(Buffer.from('data'))
    expect(events.filter((e) => e.event === 'content-read-finish').map((e) => e.bytes)).toEqual([
      4, 3,
    ])
    expect(events.find((e) => e.event === 'content-read-start').stack).toContain(
      'scaleWrites.test.ts'
    )
    expect(events.filter((e) => e.event === 'content-read-ready')).toHaveLength(1)
  } finally {
    undo()
  }
})

it('retains an uninstrumentable read handle and marks coverage unavailable', async () => {
  const { observeReads } = require('../scale/writes.cjs')
  const handle = Object.freeze({ read: async () => ({ bytesRead: 3 }) })
  const native = { open: async () => handle }
  const adapter = { getBasePath: () => '/sample', fsPromises: native }
  const events = []
  const undo = observeReads(adapter, (e) => events.push(e), [], 'fixture')
  try {
    expect(await native.open('/sample/fixture/sample.md', 'r')).toBe(handle)
    expect(events.some((e) => e.event === 'content-read-error')).toBe(true)
  } finally {
    undo()
  }
})
