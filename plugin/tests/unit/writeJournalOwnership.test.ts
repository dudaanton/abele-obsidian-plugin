import { expect, it, vi } from 'vitest'
import { JOURNAL_KEY, RECOVERED_WRITES_KEY, WriteJournal } from '@/sync/writeJournal'
import { buildFakeVault } from '../helpers/fakeVault'

it('retires only its owner while preserving foreign work appended during archival', async () => {
  const app = buildFakeVault([])
  const owned = new WriteJournal(app, undefined, 'sample')
  const foreign = new WriteJournal(app, undefined, 'other')
  owned.add({ target: 'Shared/sample.md', temp: 'Shared/sample.tmp' })
  foreign.add({ target: 'Other/first.md' })
  await owned.retireGeneration('next', async (entries) => {
    expect(entries).toEqual(owned.entries())
    foreign.add({ target: 'Other/second.md' })
  })
  expect(foreign.entries()).toEqual([
    { owner: 'other', target: 'Other/first.md' },
    { owner: 'other', target: 'Other/second.md' },
  ])
  expect(owned.entries()[0].retiredGeneration).toBe('next')
})

it('matches 5000 archived records in one linear fallback pass', async () => {
  const app = buildFakeVault([])
  const entries = Array.from({ length: 5000 }, (_, i) => ({
    owner: 'sample',
    target: `sample-${i}.md`,
    temp: `sample-${i}.tmp`,
  }))
  app.saveLocalStorage(JOURNAL_KEY, entries)
  const journal = new WriteJournal(app, undefined, 'sample')
  const stringify = JSON.stringify
  let fingerprints = 0
  const measured = vi.spyOn(JSON, 'stringify').mockImplementation((value, replacer, space) => {
    if (
      value !== null &&
      typeof value === 'object' &&
      typeof Reflect.get(value, 'target') === 'string'
    ) {
      fingerprints++
      if (fingerprints > entries.length * 3) throw new Error('Nonlinear archive matching')
    }
    return stringify(value, replacer, space)
  })
  try {
    await journal.retireGeneration('sample-generation', async (archived) => {
      expect(archived).toEqual(entries)
    })
    expect(journal.entries()).toEqual(
      entries.map((entry) => ({ ...entry, retiredGeneration: 'sample-generation' }))
    )
    expect(fingerprints).toBeLessThanOrEqual(entries.length * 3)
  } finally {
    measured.mockRestore()
  }
})

it('preserves other owners and legacy work across journal updates and retention decisions', () => {
  const app = buildFakeVault([])
  const pending = {
    target: 'Shared/sample.md',
    temp: 'Shared/sample.tmp',
    backup: 'Shared/sample.old',
  }
  const foreign = { ...pending, owner: 'other' }
  const legacy = { ...pending }
  app.saveLocalStorage(JOURNAL_KEY, [foreign, legacy])
  const retained = [
    { owner: 'other', target: pending.target, backup: pending.backup },
    { target: pending.target, backup: pending.backup },
  ]
  app.saveLocalStorage(RECOVERED_WRITES_KEY, retained)
  const owned = new WriteJournal(app, undefined, 'sample')
  expect(owned.entries()).toEqual([])
  expect(owned.recovered()).toEqual([])
  expect(owned.retainsTemp(pending.temp)).toBe(true)
  owned.add(pending)
  expect(owned.entries()).toEqual([{ ...pending, owner: 'sample' }])
  owned.replace(pending, { ...pending, installed: true })
  owned.preserve(pending)
  expect(owned.recovered()).toEqual([
    { owner: 'sample', target: pending.target, backup: pending.backup },
  ])
  owned.relocateRecovered(pending.backup, 'Shared/retained.old')
  owned.drop(pending)
  expect(new WriteJournal(app).entries()).toEqual([foreign, legacy])
  expect(new WriteJournal(app).recovered()).toEqual([
    ...retained,
    { owner: 'sample', target: pending.target, backup: 'Shared/retained.old' },
  ])
})

it('validates only the selected owner and leaves unknown legacy records untouched', () => {
  const app = buildFakeVault([])
  const untouched = [{ target: 42 }, { owner: 'other', target: null }]
  app.saveLocalStorage(JOURNAL_KEY, untouched)
  const owned = new WriteJournal(app, undefined, 'sample')
  expect(owned.entries()).toEqual([])
  const next = { target: 'Shared/new.md', temp: 'Shared/new.tmp' }
  owned.add(next)
  owned.drop(next)
  expect(app.loadLocalStorage(JOURNAL_KEY)).toEqual(untouched)
  app.saveLocalStorage(JOURNAL_KEY, [...untouched, { owner: 'sample', target: null }])
  expect(() => owned.entries()).toThrow('unreadable')
})
