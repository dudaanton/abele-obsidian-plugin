import { expect, it } from 'vitest'
import { tokenPoolMarkers } from '@/testing/tokenPoolMarkers'
import { EXTERNAL_ACTIVATION_KEY } from '@/sync/external/recovery'
import { EXTERNAL_RETIRED_KEY } from '@/sync/external/connectionSwitch'
it('removes only journal-owned token proofs and preserves foreign activation and retired evidence', () => {
  const owned = {
    ledgerId: 'owned',
    databaseName: 'owned',
    binding: { mode: 'token' },
    phase: 'active',
  }
  const foreign = {
    ledgerId: 'foreign',
    databaseName: 'foreign',
    binding: { mode: 'token' },
    phase: 'active',
  }
  const legacy = { ...owned, binding: { mode: 'personal' } }
  const data = new Map<string, unknown>([
    [EXTERNAL_ACTIVATION_KEY, { schema: 1, ledgers: [owned, foreign, legacy] }],
    [
      EXTERNAL_RETIRED_KEY,
      [
        { schema: 1, ledgers: [owned] },
        { schema: 1, ledgers: [foreign] },
      ],
    ],
  ])
  tokenPoolMarkers(
    {
      loadLocalStorage: (key) => data.get(key),
      saveLocalStorage: (key, value) => {
        data.set(key, value)
      },
    },
    ['owned']
  )()
  expect(data.get(EXTERNAL_ACTIVATION_KEY)).toEqual({ schema: 1, ledgers: [foreign, legacy] })
  expect(data.get(EXTERNAL_RETIRED_KEY)).toEqual([{ schema: 1, ledgers: [foreign] }])
})
it('refuses changed ownership before changing either marker', () => {
  const data = new Map<string, unknown>()
  const clear = tokenPoolMarkers(
    {
      loadLocalStorage: (key) => data.get(key),
      saveLocalStorage: (key, value) => {
        data.set(key, value)
      },
    },
    []
  )
  data.set(EXTERNAL_ACTIVATION_KEY, 'changed')
  expect(clear).toThrow(/changed/)
  expect(data.get(EXTERNAL_ACTIVATION_KEY)).toBe('changed')
  expect(data.has(EXTERNAL_RETIRED_KEY)).toBe(false)
})
