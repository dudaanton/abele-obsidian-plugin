import { expect, it } from 'vitest'
import { DirectEntryDurability } from '@/sync/directEntryDurability'
import { deferred } from '../helpers/deferred'

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
