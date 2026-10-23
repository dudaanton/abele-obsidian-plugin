// @vitest-environment node
import { expect, it } from 'vitest'
import { createRequire } from 'node:module'
import * as fsp from 'node:fs/promises'
import { join } from 'node:path'
const require = createRequire(import.meta.url)

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
