import { expect, it } from 'vitest'
import { DirectEntryDurability, directEntryDurability } from '@/sync/directEntryDurability'
import { deferred } from '../helpers/deferred'

it('adopts clean pre-reload durability facts without losing dirty entries or directory proofs', async () => {
  const legacy = {
    dirty: new Map([['notes', 3]]),
    generation: 3,
    flushing: new Map(),
    directories: { children: new Map([['notes', { children: new Map() }]]) },
  }
  const host = { [Symbol.for('abele.sync.direct-entry-durability-v1')]: legacy }
  const state = directEntryDurability(host)
  expect(state.settled).toBeTypeOf('function')
  expect(state.directoryKnown('notes')).toBe(true)
  const flushed: string[] = []
  await state.flushAncestors('notes/sample.md', async (path) => {
    flushed.push(path)
  })
  await state.settled()
  expect(flushed).toEqual(['notes'])
  expect(directEntryDurability(host)).toBe(state)
})

it('keeps pre-reload work intact and refuses adoption until its old directory barriers settle', () => {
  const legacy = {
    dirty: new Map([['notes', 3]]),
    generation: 3,
    flushing: new Map([['notes', []]]),
    directories: { children: new Map() },
  }
  const host = { [Symbol.for('abele.sync.direct-entry-durability-v1')]: legacy }
  let failure: unknown
  try {
    directEntryDurability(host)
  } catch (error) {
    failure = error
  }
  expect(failure).toMatchObject({ code: 'offline', retryable: true })
  expect(host[Symbol.for('abele.sync.direct-entry-durability-v1')]).toBe(legacy)
  expect(legacy.dirty.get('notes')).toBe(3)
  legacy.flushing.clear()
  expect(directEntryDurability(host).settled).toBeTypeOf('function')
})

it('acknowledges only after direct entry changes are durable, deepest first, across every flush cut', async () => {
  for (let cut = 0; cut <= 3; cut++) {
    const dirty = new DirectEntryDurability()
    const volatile = new Set(['', 'existing'])
    const durable = new Set(volatile)
    const create = (path: string) => {
      volatile.add(path)
      dirty.changed(path)
    }
    create('existing/private')
    create('existing/private/record.json')
    const flushed: string[] = []
    let acknowledged = false
    try {
      await dirty.flushAncestors('existing/private/record.json', async (directory) => {
        if (flushed.length === cut) throw new Error('process exit')
        for (const path of volatile)
          if (path.slice(0, Math.max(0, path.lastIndexOf('/'))) === directory) durable.add(path)
        flushed.push(directory)
      })
      acknowledged = true
    } catch (error) {
      expect(String(error)).toContain('process exit')
    }
    if (acknowledged) {
      expect(durable).toContain('existing/private')
      expect(durable).toContain('existing/private/record.json')
      expect(flushed).toEqual(['existing/private', 'existing'])
      await dirty.flushAncestors('existing/private/record.json', async () => {
        throw new Error('clean directory flushed twice')
      })
    }
  }
})

it('does not clear a mutation made while a directory flush is in flight', async () => {
  const dirty = new DirectEntryDurability()
  dirty.changed('sample/first.md')
  const entered = deferred<void>(),
    release = deferred<void>()
  const pending = dirty.flushAncestors('sample/first.md', async () => {
    entered.resolve()
    await release.promise
  })
  await entered.promise
  dirty.changed('sample/second.md')
  release.resolve()
  await pending
  const flushed: string[] = []
  await dirty.flushAncestors('sample/second.md', async (path) => {
    flushed.push(path)
  })
  expect(flushed).toEqual(['sample'])
})

it('retains dirty entries after a failed flush and tracks both sides of a rename', async () => {
  const dirty = new DirectEntryDurability()
  dirty.changed('source/one.md', 'destination/one.md')
  await expect(
    dirty.flushAncestors('source/one.md', async () => {
      throw new Error('disk full')
    })
  ).rejects.toThrow('disk full')
  const flushed: string[] = []
  for (const path of ['source/one.md', 'destination/one.md'])
    await dirty.flushAncestors(path, async (directory) => {
      flushed.push(directory)
    })
  expect(flushed).toEqual(['source', 'destination'])
})

it('re-establishes barriers for owned work after a process restart loses its dirty marks', async () => {
  const restarted = new DirectEntryDurability()
  restarted.resume(['new/private/payload.bin'])
  const flushed: string[] = []
  await restarted.flushAncestors('new/private/payload.bin', async (path) => {
    flushed.push(path)
  })
  expect(flushed).toEqual(['new/private', 'new', ''])
})

it('retains parent existence across child writes, but invalidates moved ancestors and fresh polls', async () => {
  const facts = new DirectEntryDurability()
  facts.rememberDirectory('private/stages')
  facts.changed('private/stages/one.tmp')
  expect(facts.directoryKnown('private/stages')).toBe(true)
  facts.changed('private', 'moved')
  expect(facts.directoryKnown('private/stages')).toBe(false)
  facts.rememberDirectory('moved/stages')
  facts.changed('moved/stages/two.tmp')
  facts.forgetDirectories()
  expect(facts.directoryKnown('moved/stages')).toBe(false)
  const flushed: string[] = []
  await facts.flushAncestors('moved/stages/two.tmp', async (path) => {
    flushed.push(path)
  })
  expect(flushed).toContain('moved/stages')
})

it('waits for every yielded ancestor chain before acknowledging a durability stop', async () => {
  const dirty = new DirectEntryDurability()
  const entered = deferred<void>(),
    release = deferred<void>()
  const paths = Array.from({ length: 32 }, (_, i) => `notes/folder-${i}/nested/file.md`)
  dirty.resume(paths)
  let acknowledged = false
  const flushed: string[] = []
  const writes = paths.map((path) =>
    dirty.flushAncestors(path, async (directory) => {
      expect(acknowledged, 'no barrier may start after the stop acknowledgement').toBe(false)
      entered.resolve()
      await release.promise
      flushed.push(directory)
    })
  )
  const stop = dirty.settled().then(() => {
    acknowledged = true
  })
  await entered.promise
  expect(acknowledged).toBe(false)
  release.resolve()
  await stop
  await Promise.all(writes)
  expect(acknowledged).toBe(true)
  for (let i = 0; i < 32; i++) {
    expect(flushed).toContain(`notes/folder-${i}/nested`)
    expect(flushed).toContain(`notes/folder-${i}`)
  }
  expect(flushed).toContain('notes')
  expect(flushed).toContain('')
})

it('refuses a stop after a failed barrier until that dirty directory is durably retried', async () => {
  const dirty = new DirectEntryDurability()
  dirty.changed('notes/sample.md')
  await expect(
    dirty.flushAncestors('notes/sample.md', async () => {
      throw new Error('sample disk failure')
    })
  ).rejects.toThrow('sample disk failure')
  await expect(dirty.settled()).rejects.toThrow('sample disk failure')
  const retried: string[] = []
  await dirty.flushAncestors('notes/sample.md', async (directory) => {
    retried.push(directory)
  })
  await dirty.settled()
  expect(retried).toEqual(['notes'])
})
