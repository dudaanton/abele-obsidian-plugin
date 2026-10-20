import { expect, it } from 'vitest'
import { PathCoordinator, PLACEMENT, coordinatedFileSystem } from '@/sync/pathCoordinator'
import { MemoryFileSystem } from '@abele/sync-sdk/core'
import { vi } from 'vitest'
import { deferred } from '../helpers/deferred'

it('preserves only overwritten files while leasing all acknowledged paths', async () => {
  const gate = deferred<void>(),
    preserve = vi.fn(async () => {})
  const fs = coordinatedFileSystem(
    new MemoryFileSystem(),
    new PathCoordinator(),
    () => {},
    preserve
  )
  const place = Reflect.get(fs, PLACEMENT) as (
    paths: string[],
    work: () => Promise<void>,
    preserve: readonly string[]
  ) => Promise<void>
  const batch = place(['sent.md', 'merged.md'], () => gate.promise, ['merged.md'])
  let entered = false
  const queued = place(
    ['sent.md'],
    async () => {
      entered = true
    },
    []
  )
  await Promise.resolve()
  expect(preserve).toHaveBeenCalledExactlyOnceWith(['merged.md'])
  expect(entered).toBe(false)
  gate.resolve()
  await Promise.all([batch, queued])
  expect(entered).toBe(true)
  expect(preserve).toHaveBeenCalledTimes(1)
})

it('keeps directory creation leased while retaining preservation for a queued file replacement', async () => {
  const gate = deferred<void>(),
    preserve = vi.fn(async () => {})
  const fs = coordinatedFileSystem(
    new MemoryFileSystem(),
    new PathCoordinator(),
    () => {},
    preserve
  )
  const place = Reflect.get(fs, PLACEMENT) as (
    paths: string[],
    work: () => Promise<void>,
    preserve?: boolean
  ) => Promise<void>
  const directory = place(['Shared'], () => gate.promise, false)
  let replaced = false
  const file = place(['Shared/sample.md'], async () => {
    replaced = true
  })
  expect(preserve).not.toHaveBeenCalled()
  expect(replaced).toBe(false)
  gate.resolve()
  await Promise.all([directory, file])
  expect(preserve).toHaveBeenCalledExactlyOnceWith(['Shared/sample.md'])
  expect(replaced).toBe(true)
})

it('serializes case aliases and directory overlaps, while unrelated paths continue', async () => {
  const locks = new PathCoordinator()
  const gate = deferred<void>()
  const events: string[] = []
  const first = locks.run(['Folder/Note.md'], async () => {
    events.push('first')
    await gate.promise
  })
  const alias = locks.run(['folder/note.md'], async () => {
    events.push('alias')
  })
  const directory = locks.run(['folder'], async () => {
    events.push('directory')
  })
  await locks.run(['other.md'], async () => {
    events.push('other')
  })
  expect(events).toEqual(['first', 'other'])
  gate.resolve()
  await Promise.all([first, alias, directory])
  expect(events).toEqual(['first', 'other', 'alias', 'directory'])
})

it('dispatches each successor once when an earlier queued owner is revoked', async () => {
  const locks = new PathCoordinator(),
    gate = deferred<void>()
  const first = locks.run(['sample.md'], () => gate.promise)
  const stale = locks.run(
    ['sample.md'],
    async () => {},
    () => {
      throw new Error('revoked')
    }
  )
  const rejected = expect(stale).rejects.toThrow('revoked')
  let writes = 0
  const next = locks.run(['sample.md'], async () => {
    writes++
  })
  gate.resolve()
  await Promise.all([first, rejected, next])
  expect(writes).toBe(1)
})

it('acquires both rename ends atomically and releases after failure without deadlock', async () => {
  const locks = new PathCoordinator()
  const gate = deferred<void>()
  const a = locks.run(['a.md', 'b.md'], async () => {
    await gate.promise
    throw new Error('failed')
  })
  const rejected = expect(a).rejects.toThrow('failed')
  let completed = false
  const b = locks.run(['b.md', 'a.md'], async () => {
    completed = true
  })
  expect(completed).toBe(false)
  gate.resolve()
  await rejected
  await b
  expect(completed).toBe(true)
})

it('checks runtime ownership after waiting, before any placement', async () => {
  const locks = new PathCoordinator()
  const gate = deferred<void>()
  const first = locks.run(['sample.md'], () => gate.promise)
  let active = true
  let wrote = false
  const second = locks.run(
    ['sample.md'],
    async () => {
      wrote = true
    },
    () => {
      if (!active) throw new Error('old runtime')
    }
  )
  const rejected = expect(second).rejects.toThrow('old runtime')
  active = false
  gate.resolve()
  await first
  await rejected
  expect(wrote).toBe(false)
})
