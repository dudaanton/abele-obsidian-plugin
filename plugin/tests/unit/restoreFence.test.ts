import { expect, it, vi } from 'vitest'
import { GENERATION_KEY, EXTERNAL_STATE_KEY, MemoryStateStore } from '@abele/sync-sdk/core'
import { assertResponseGeneration, fenceHostGeneration } from '@/sync/restoreFence'
import { WriteJournal } from '@/sync/writeJournal'

it('retires write intents after durable archival while keeping their artifacts protected', async () => {
  const data = new Map<string, unknown>()
  const journal = new WriteJournal({
    loadLocalStorage: (key) => data.get(key) ?? null,
    saveLocalStorage: (key, value) => {
      data.set(key, value)
    },
  })
  journal.add({ target: 'sample.bin', temp: 'sample.tmp', backup: 'sample.bak' })
  await expect(
    journal.retireGeneration('new', async () => {
      throw new Error('archive failed')
    })
  ).rejects.toThrow('archive failed')
  expect(journal.entries()[0].retiredGeneration).toBeUndefined()
  const save = vi.fn(async () => {})
  await journal.retireGeneration('new', save)
  expect(save).toHaveBeenCalledWith([
    { target: 'sample.bin', temp: 'sample.tmp', backup: 'sample.bak' },
  ])
  expect(journal.entries()[0]).toMatchObject({
    retiredGeneration: 'new',
    temp: 'sample.tmp',
    backup: 'sample.bak',
  })
})

it('archives pending publication before host writes and is restartable before core retirement', async () => {
  const state = new MemoryStateStore()
  await state.setMeta(GENERATION_KEY, 'old')
  await state.setMeta('token-asset-outbox', '["retained-source"]')
  const archive = vi.fn(async (save) => {
    expect(await state.getMeta('token-asset-outbox')).toBeNull()
    await save([{ target: 'sample.bin', backup: 'private-backup' }])
  })
  expect(await fenceHostGeneration(state, 'new', archive)).toBe(true)
  expect(
    JSON.parse((await state.getMeta('retired-host-generation:old'))!).metadata['token-asset-outbox']
  ).toBe('["retained-source"]')
  await fenceHostGeneration(state, 'new', archive)
  expect(JSON.parse((await state.getMeta('retired-host-generation:old:writes'))!)).toHaveLength(1)
  await state.setMeta(GENERATION_KEY, 'new')
  expect(await fenceHostGeneration(state, 'new', archive)).toBe(false)
  expect(archive).toHaveBeenCalledTimes(2)
})

it('holds external effects with their original document retained', async () => {
  const state = new MemoryStateStore()
  await state.setMeta(GENERATION_KEY, 'old')
  await state.setMeta(EXTERNAL_STATE_KEY, '{"files":["retained"]}')
  await expect(fenceHostGeneration(state, 'new')).rejects.toThrow('Sync recovery required')
  expect(await state.getMeta(EXTERNAL_STATE_KEY)).toBe('{"files":["retained"]}')
  expect(await state.getMeta('retired-host-generation:old:external')).toBe('{"files":["retained"]}')
})

it('rejects changed generations before a response can produce host effects', () => {
  expect(() =>
    assertResponseGeneration(
      new Response(null, { headers: { 'abele-restore-generation': 'new' } }),
      'old'
    )
  ).toThrow('generation changed')
  expect(() => assertResponseGeneration(new Response(), 'old')).not.toThrow()
})
